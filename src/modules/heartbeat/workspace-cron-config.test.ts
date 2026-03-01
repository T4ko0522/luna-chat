import { readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  loadWorkspaceCronConfig,
  parseWorkspaceCronConfig,
  removeWorkspaceCronJob,
  stringifyWorkspaceCronConfig,
  type WorkspaceCronConfig,
  WorkspaceCronConfigError,
} from "./workspace-cron-config";

describe("parseWorkspaceCronConfig", () => {
  it("jobs テーブルマップを読み込む", () => {
    const config = parseWorkspaceCronConfig(
      {
        jobs: {
          daily_check: {
            cron: "0 0 9 * * *",
            prompt: "daily",
          },
          oneshot_task: {
            cron: "0 */15 * * * *",
            oneshot: true,
            prompt: "oneshot",
          },
        },
      },
      "UTC",
    );

    expect(config.jobs).toEqual([
      {
        cronTime: "0 0 9 * * *",
        id: "daily_check",
        oneshot: false,
        prompt: "daily",
      },
      {
        cronTime: "0 */15 * * * *",
        id: "oneshot_task",
        oneshot: true,
        prompt: "oneshot",
      },
    ]);
  });

  it("jobs 未設定なら空配列として扱う", () => {
    const config = parseWorkspaceCronConfig({}, undefined);
    expect(config.jobs).toEqual([]);
  });

  it("cron が不正なら失敗する", () => {
    expect(() => {
      parseWorkspaceCronConfig(
        {
          jobs: {
            invalid: {
              cron: "not-a-cron",
              prompt: "x",
            },
          },
        },
        "UTC",
      );
    }).toThrowError(WorkspaceCronConfigError);
  });

  it("timeZone が不正なら失敗する", () => {
    expect(() => {
      parseWorkspaceCronConfig(
        {
          jobs: {
            valid: {
              cron: "0 0 9 * * *",
              prompt: "x",
            },
          },
        },
        "Mars/Phobos",
      );
    }).toThrowError(WorkspaceCronConfigError);
  });
});

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
      `[jobs.daily]
cron = "0 0 9 * * *"
prompt = "daily"
`,
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
      ]);
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
      stringifyWorkspaceCronConfig(
        createConfig(["a", "b"], {
          b: true,
        }),
      ),
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
    await writeFile(configPath, stringifyWorkspaceCronConfig(createConfig(["a"])));

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

function createConfig(
  ids: string[],
  oneshotMap: Record<string, boolean> = {},
): WorkspaceCronConfig {
  return {
    jobs: ids.map((id, index) => {
      return {
        cronTime: "0 */5 * * * *",
        id,
        oneshot: oneshotMap[id] ?? false,
        prompt: `prompt-${String.fromCharCode(97 + index)}`,
      };
    }),
  };
}
