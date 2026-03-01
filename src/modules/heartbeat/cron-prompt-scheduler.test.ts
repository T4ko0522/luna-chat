import { describe, expect, it, type Mock, vi } from "vitest";

import type { AiService } from "../ai/ports/inbound/ai-service-port";

import { startCronPromptScheduler, type CronPromptCronJobOptions } from "./cron-prompt-scheduler";
import type { WorkspaceCronJob } from "./workspace-cron-config";

describe("startCronPromptScheduler", () => {
  it("起動時にジョブを作成し、停止時にジョブとwatcherを閉じる", async () => {
    const aiService = createAiService(vi.fn(async () => undefined));
    const logger = createLoggerStub();
    const cronCapture = createCronCapture();
    const watcher = new FakeWatcher();
    const loadWorkspaceCronConfig = vi.fn(async () => {
      return {
        jobs: [createJob("a", "0 0 9 * * *", "prompt-a"), createJob("b", "0 */15 * * * *", "p-b")],
      };
    });

    const scheduler = await startCronPromptScheduler({
      aiService,
      createCronJob: cronCapture.createCronJob,
      createWatcher: () => watcher,
      debounceMs: 0,
      loadWorkspaceCronConfig,
      logger,
      removeWorkspaceCronJob: vi.fn(async () => false),
      timeZone: "UTC",
      workspaceDir: "/tmp/workspace",
    });

    expect(cronCapture.createCronJob).toHaveBeenCalledTimes(2);
    for (const captured of cronCapture.created) {
      expect(captured.options.start).toBe(true);
      expect(captured.options.waitForCompletion).toBe(true);
      expect(captured.options.timeZone).toBe("UTC");
    }

    await scheduler.stop();
    expect(watcher.close).toHaveBeenCalledTimes(1);
    expect(cronCapture.created[0]?.stop).toHaveBeenCalledTimes(1);
    expect(cronCapture.created[1]?.stop).toHaveBeenCalledTimes(1);
  });

  it("cron tick で prompt を使って heartbeat を実行する", async () => {
    const generateHeartbeat = vi.fn(async () => undefined);
    const aiService = createAiService(generateHeartbeat);
    const logger = createLoggerStub();
    const cronCapture = createCronCapture();
    const watcher = new FakeWatcher();

    const scheduler = await startCronPromptScheduler({
      aiService,
      createCronJob: cronCapture.createCronJob,
      createWatcher: () => watcher,
      debounceMs: 0,
      loadWorkspaceCronConfig: vi.fn(async () => {
        return {
          jobs: [createJob("a", "0 */5 * * * *", "cron prompt")],
        };
      }),
      logger,
      removeWorkspaceCronJob: vi.fn(async () => false),
      workspaceDir: "/tmp/workspace",
    });

    await cronCapture.created[0]?.options.onTick();
    expect(generateHeartbeat).toHaveBeenCalledTimes(1);
    expect(generateHeartbeat).toHaveBeenCalledWith({
      prompt: "cron prompt",
      source: "cron",
    });

    await scheduler.stop();
  });

  it("同一ジョブ実行中の重複tickをスキップする", async () => {
    const heartbeatGate = createDeferred<void>();
    const generateHeartbeat = vi.fn(async () => {
      await heartbeatGate.promise;
    });
    const aiService = createAiService(generateHeartbeat);
    const logger = createLoggerStub();
    const cronCapture = createCronCapture();
    const watcher = new FakeWatcher();

    const scheduler = await startCronPromptScheduler({
      aiService,
      createCronJob: cronCapture.createCronJob,
      createWatcher: () => watcher,
      debounceMs: 0,
      loadWorkspaceCronConfig: vi.fn(async () => {
        return {
          jobs: [createJob("a", "0 */5 * * * *", "cron prompt")],
        };
      }),
      logger,
      removeWorkspaceCronJob: vi.fn(async () => false),
      workspaceDir: "/tmp/workspace",
    });

    const firstTickPromise = cronCapture.created[0]?.options.onTick();
    await cronCapture.created[0]?.options.onTick();
    expect(generateHeartbeat).toHaveBeenCalledTimes(1);

    heartbeatGate.resolve(undefined);
    await firstTickPromise;
    await scheduler.stop();
  });

  it("oneshot は成功時に設定ファイルから削除する", async () => {
    const generateHeartbeat = vi.fn(async () => undefined);
    const removeWorkspaceCronJob = vi.fn(async () => true);
    const aiService = createAiService(generateHeartbeat);
    const logger = createLoggerStub();
    const cronCapture = createCronCapture();
    const watcher = new FakeWatcher();

    const scheduler = await startCronPromptScheduler({
      aiService,
      createCronJob: cronCapture.createCronJob,
      createWatcher: () => watcher,
      debounceMs: 0,
      loadWorkspaceCronConfig: vi.fn(async () => {
        return {
          jobs: [createJob("oneshot", "0 */5 * * * *", "run once", true)],
        };
      }),
      logger,
      removeWorkspaceCronJob,
      workspaceDir: "/tmp/workspace",
    });

    await cronCapture.created[0]?.options.onTick();
    await vi.waitFor(() => {
      expect(removeWorkspaceCronJob).toHaveBeenCalledTimes(1);
    });
    expect(cronCapture.created[0]?.stop).toHaveBeenCalledTimes(1);

    await scheduler.stop();
  });

  it("oneshot は失敗時でも設定ファイルから削除する", async () => {
    const generateHeartbeat = vi.fn(async () => {
      throw new Error("failed");
    });
    const removeWorkspaceCronJob = vi.fn(async () => true);
    const aiService = createAiService(generateHeartbeat);
    const logger = createLoggerStub();
    const cronCapture = createCronCapture();
    const watcher = new FakeWatcher();

    const scheduler = await startCronPromptScheduler({
      aiService,
      createCronJob: cronCapture.createCronJob,
      createWatcher: () => watcher,
      debounceMs: 0,
      loadWorkspaceCronConfig: vi.fn(async () => {
        return {
          jobs: [createJob("oneshot", "0 */5 * * * *", "run once", true)],
        };
      }),
      logger,
      removeWorkspaceCronJob,
      workspaceDir: "/tmp/workspace",
    });

    await cronCapture.created[0]?.options.onTick();
    await vi.waitFor(() => {
      expect(removeWorkspaceCronJob).toHaveBeenCalledTimes(1);
    });

    await scheduler.stop();
  });

  it("watch変更で設定が変わった場合はジョブを差し替える", async () => {
    const aiService = createAiService(vi.fn(async () => undefined));
    const logger = createLoggerStub();
    const cronCapture = createCronCapture();
    const watcher = new FakeWatcher();
    const loadWorkspaceCronConfig = vi
      .fn<
        (
          configPath: string,
          timeZone: string | undefined,
        ) => Promise<{ jobs: ReadonlyArray<WorkspaceCronJob> }>
      >()
      .mockResolvedValueOnce({
        jobs: [createJob("a", "0 */5 * * * *", "prompt-a")],
      })
      .mockResolvedValueOnce({
        jobs: [createJob("a", "0 */10 * * * *", "prompt-a")],
      });

    const scheduler = await startCronPromptScheduler({
      aiService,
      createCronJob: cronCapture.createCronJob,
      createWatcher: () => watcher,
      debounceMs: 0,
      loadWorkspaceCronConfig,
      logger,
      removeWorkspaceCronJob: vi.fn(async () => false),
      workspaceDir: "/tmp/workspace",
    });

    watcher.emit("change");
    await vi.waitFor(() => {
      expect(loadWorkspaceCronConfig).toHaveBeenCalledTimes(2);
    });
    expect(cronCapture.createCronJob).toHaveBeenCalledTimes(2);
    expect(cronCapture.created[0]?.stop).toHaveBeenCalledTimes(1);

    await scheduler.stop();
  });

  it("watch変更後のロードが失敗した場合は前回ジョブを維持する", async () => {
    const aiService = createAiService(vi.fn(async () => undefined));
    const logger = createLoggerStub();
    const cronCapture = createCronCapture();
    const watcher = new FakeWatcher();
    const loadWorkspaceCronConfig = vi
      .fn<
        (
          configPath: string,
          timeZone: string | undefined,
        ) => Promise<{ jobs: ReadonlyArray<WorkspaceCronJob> }>
      >()
      .mockResolvedValueOnce({
        jobs: [createJob("a", "0 */5 * * * *", "prompt-a")],
      })
      .mockRejectedValueOnce(new Error("invalid toml"));

    const scheduler = await startCronPromptScheduler({
      aiService,
      createCronJob: cronCapture.createCronJob,
      createWatcher: () => watcher,
      debounceMs: 0,
      loadWorkspaceCronConfig,
      logger,
      removeWorkspaceCronJob: vi.fn(async () => false),
      workspaceDir: "/tmp/workspace",
    });

    watcher.emit("change");
    await vi.waitFor(() => {
      expect(loadWorkspaceCronConfig).toHaveBeenCalledTimes(2);
    });

    expect(cronCapture.createCronJob).toHaveBeenCalledTimes(1);
    expect(cronCapture.created[0]?.stop).toHaveBeenCalledTimes(0);

    await scheduler.stop();
  });
});

function createAiService(generateHeartbeat: AiService["generateHeartbeat"]): AiService {
  return {
    generateHeartbeat,
    generateReply: async () => undefined,
  };
}

function createJob(
  id: string,
  cronTime: string,
  prompt: string,
  oneshot = false,
): WorkspaceCronJob {
  return {
    cronTime,
    id,
    oneshot,
    prompt,
  };
}

function createLoggerStub(): {
  error: Mock;
  info: Mock;
} {
  return {
    error: vi.fn(),
    info: vi.fn(),
  };
}

function createCronCapture(): {
  createCronJob: Mock<(options: CronPromptCronJobOptions) => { stop: () => void }>;
  created: Array<{
    options: CronPromptCronJobOptions;
    stop: Mock;
  }>;
} {
  const created: Array<{
    options: CronPromptCronJobOptions;
    stop: Mock;
  }> = [];
  const createCronJob = vi.fn((options: CronPromptCronJobOptions) => {
    const stop = vi.fn();
    created.push({
      options,
      stop,
    });
    return {
      stop,
    };
  });

  return {
    createCronJob,
    created,
  };
}

class FakeWatcher {
  private readonly handlers: Record<
    "add" | "change" | "error" | "unlink",
    Array<(...arguments_: unknown[]) => void>
  > = {
    add: [],
    change: [],
    error: [],
    unlink: [],
  };

  readonly close = vi.fn(async () => undefined);

  on(
    event: "add" | "change" | "error" | "unlink",
    listener: (...arguments_: unknown[]) => void,
  ): FakeWatcher {
    this.handlers[event].push(listener);
    return this;
  }

  emit(event: "add" | "change" | "error" | "unlink", ...arguments_: unknown[]): void {
    for (const handler of this.handlers[event]) {
      handler(...arguments_);
    }
  }
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return {
    promise,
    reject,
    resolve,
  };
}
