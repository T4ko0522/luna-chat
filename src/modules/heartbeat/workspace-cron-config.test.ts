import { readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  loadWorkspaceCronConfig,
  removeWorkspaceCronJob,
  WorkspaceCronConfigError,
} from "./workspace-cron-config";

describe("loadWorkspaceCronConfig", () => {
  it("ファイルが存在しない場合は空設定を返す", async () => {
    const configPath = resolve(
      join(tmpdir(), `luna-cron-config-missing-${Date.now()}-${Math.random().toString(16)}.toml`),
    );
    const loaded = await loadWorkspaceCronConfig(configPath, undefined);
    expect(loaded.jobs).toEqual([]);
  });

  it("cron.toml を読み込める", async () => {
    const configPath = createTempConfigPath();
    await writeFile(
      configPath,
      `[jobs.daily]\ncron = "0 0 9 * * *"\nprompt = "daily"\n\n[jobs.oneshot]\ncron = "0 */15 * * * *"\nprompt = "oneshot"\noneshot = true\n`,
    );

    try {
      const loaded = await loadWorkspaceCronConfig(configPath, "UTC");
      expect(loaded.jobs).toEqual([
        {
          cronTime: "0 0 9 * * *",
          id: "daily",
          oneshot: false,
          prompt: "daily",
        },
        {
          cronTime: "0 */15 * * * *",
          id: "oneshot",
          oneshot: true,
          prompt: "oneshot",
        },
      ]);
    } finally {
      await rm(configPath, {
        force: true,
      });
    }
  });

  it("cron が不正なら失敗する", async () => {
    const configPath = createTempConfigPath();
    await writeFile(configPath, `[jobs.invalid]\ncron = "not-a-cron"\nprompt = "x"\n`);

    try {
      await expect(loadWorkspaceCronConfig(configPath, "UTC")).rejects.toThrowError(
        WorkspaceCronConfigError,
      );
    } finally {
      await rm(configPath, {
        force: true,
      });
    }
  });

  it("timeZone が不正なら失敗する", async () => {
    const configPath = createTempConfigPath();
    await writeFile(configPath, `[jobs.valid]\ncron = "0 0 9 * * *"\nprompt = "x"\n`);

    try {
      await expect(loadWorkspaceCronConfig(configPath, "Mars/Phobos")).rejects.toThrowError(
        WorkspaceCronConfigError,
      );
    } finally {
      await rm(configPath, {
        force: true,
      });
    }
  });
});

describe("removeWorkspaceCronJob", () => {
  it("指定ジョブを削除して書き戻す", async () => {
    const configPath = createTempConfigPath();
    await writeFile(
      configPath,
      `[jobs.a]\ncron = "0 */5 * * * *"\nprompt = "prompt-a"\n\n[jobs.b]\ncron = "0 */5 * * * *"\nprompt = "prompt-b"\noneshot = true\n`,
    );

    try {
      const removed = await removeWorkspaceCronJob(configPath, "a");
      expect(removed).toBe(true);

      const loaded = await loadWorkspaceCronConfig(configPath, "UTC");
      expect(loaded.jobs).toEqual([
        {
          cronTime: "0 */5 * * * *",
          id: "b",
          oneshot: true,
          prompt: "prompt-b",
        },
      ]);
    } finally {
      await rm(configPath, {
        force: true,
      });
    }
  });

  it("存在しないジョブは削除しない", async () => {
    const configPath = createTempConfigPath();
    await writeFile(configPath, `[jobs.a]\ncron = "0 */5 * * * *"\nprompt = "prompt-a"\n`);

    try {
      const before = await readFile(configPath, "utf8");
      const removed = await removeWorkspaceCronJob(configPath, "missing");
      const after = await readFile(configPath, "utf8");

      expect(removed).toBe(false);
      expect(after).toBe(before);
    } finally {
      await rm(configPath, {
        force: true,
      });
    }
  });
});

function createTempConfigPath(): string {
  return resolve(
    join(tmpdir(), `luna-cron-config-${Date.now()}-${Math.random().toString(16)}.toml`),
  );
}
