import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { loadRuntimeConfig, RuntimeConfigError } from "./runtime-config";

describe("loadRuntimeConfig", () => {
  it("必須設定のみ読み込む", async () => {
    const lunaHomeDir = createTempLunaHomeDir();
    const config = await loadRuntimeConfig({
      ALLOWED_CHANNEL_IDS: "111, 222,333",
      LUNA_HOME: lunaHomeDir,
      DISCORD_BOT_TOKEN: "token",
    });

    expect(config.discordBotToken).toBe("token");
    expect(Array.from(config.allowedChannelIds)).toEqual(["111", "222", "333"]);
    expect(config.lunaHomeDir).toBe(resolve(lunaHomeDir));
    expect(config.codexWorkspaceDir).toBe(resolve(lunaHomeDir, "workspace"));
    expect(config.codexHomeDir).toBe(resolve(lunaHomeDir, "codex"));
    expect(config.logsDir).toBe(resolve(lunaHomeDir, "logs"));

    await rm(config.lunaHomeDir, {
      force: true,
      recursive: true,
    });
  });

  it("LUNA_HOME が ~/ 形式ならホーム配下へ展開する", async () => {
    const originalHome = process.env["HOME"];
    const testHome = createTempLunaHomeDir();
    await mkdir(testHome, {
      recursive: true,
    });
    process.env["HOME"] = testHome;

    const relativeLunaHome = `.luna-runtime-config-test-${Date.now()}`;
    try {
      const config = await loadRuntimeConfig({
        ALLOWED_CHANNEL_IDS: "111",
        LUNA_HOME: `~/${relativeLunaHome}`,
        DISCORD_BOT_TOKEN: "token",
      });

      expect(config.lunaHomeDir).toBe(resolve(testHome, relativeLunaHome));
      expect(config.codexWorkspaceDir).toBe(resolve(testHome, relativeLunaHome, "workspace"));
      expect(config.codexHomeDir).toBe(resolve(testHome, relativeLunaHome, "codex"));
      expect(config.logsDir).toBe(resolve(testHome, relativeLunaHome, "logs"));

      await rm(config.lunaHomeDir, {
        force: true,
        recursive: true,
      });
    } finally {
      if (originalHome === undefined) {
        delete process.env["HOME"];
      } else {
        process.env["HOME"] = originalHome;
      }
      await rm(testHome, {
        force: true,
        recursive: true,
      });
    }
  });

  it("workspace と codex と logs ディレクトリを自動作成する", async () => {
    const lunaHomeDir = createTempLunaHomeDir();
    const workspaceDir = resolve(lunaHomeDir, "workspace");
    const codexHomeDir = resolve(lunaHomeDir, "codex");
    const logsDir = resolve(lunaHomeDir, "logs");
    await rm(workspaceDir, {
      force: true,
      recursive: true,
    });
    await rm(codexHomeDir, {
      force: true,
      recursive: true,
    });
    await rm(logsDir, {
      force: true,
      recursive: true,
    });

    await loadRuntimeConfig({
      ALLOWED_CHANNEL_IDS: "111",
      LUNA_HOME: lunaHomeDir,
      DISCORD_BOT_TOKEN: "token",
    });

    expect(await exists(workspaceDir)).toBe(true);
    expect(await exists(codexHomeDir)).toBe(true);
    expect(await exists(logsDir)).toBe(true);

    await rm(lunaHomeDir, {
      force: true,
      recursive: true,
    });
  });

  it("workspace に templates の不足ファイルを補完する", async () => {
    const lunaHomeDir = createTempLunaHomeDir();
    const templatesDir = await createTempTemplatesDir({
      "LUNA.md": "LUNA template",
      "SOUL.md": "SOUL template",
    });
    try {
      await loadRuntimeConfig(
        {
          ALLOWED_CHANNEL_IDS: "111",
          LUNA_HOME: lunaHomeDir,
          DISCORD_BOT_TOKEN: "token",
        },
        {
          templatesDir,
        },
      );

      expect(await readFile(resolve(lunaHomeDir, "workspace", "LUNA.md"), "utf8")).toBe(
        "LUNA template",
      );
      expect(await readFile(resolve(lunaHomeDir, "workspace", "SOUL.md"), "utf8")).toBe(
        "SOUL template",
      );
    } finally {
      await rm(lunaHomeDir, {
        force: true,
        recursive: true,
      });
      await rm(templatesDir, {
        force: true,
        recursive: true,
      });
    }
  });

  it("workspace に既存ファイルがあれば templates で上書きしない", async () => {
    const lunaHomeDir = createTempLunaHomeDir();
    const workspaceDir = resolve(lunaHomeDir, "workspace");
    const templatesDir = await createTempTemplatesDir({
      "LUNA.md": "LUNA template",
      "SOUL.md": "SOUL template",
    });
    await mkdir(workspaceDir, {
      recursive: true,
    });
    await writeFile(resolve(workspaceDir, "LUNA.md"), "custom LUNA");

    try {
      await loadRuntimeConfig(
        {
          ALLOWED_CHANNEL_IDS: "111",
          LUNA_HOME: lunaHomeDir,
          DISCORD_BOT_TOKEN: "token",
        },
        {
          templatesDir,
        },
      );

      expect(await readFile(resolve(workspaceDir, "LUNA.md"), "utf8")).toBe("custom LUNA");
      expect(await readFile(resolve(workspaceDir, "SOUL.md"), "utf8")).toBe("SOUL template");
    } finally {
      await rm(lunaHomeDir, {
        force: true,
        recursive: true,
      });
      await rm(templatesDir, {
        force: true,
        recursive: true,
      });
    }
  });

  it("templates 直下の通常ファイルのみを workspace へ補完する", async () => {
    const lunaHomeDir = createTempLunaHomeDir();
    const templatesDir = await createTempTemplatesDir({
      "LUNA.md": "LUNA template",
    });
    const nestedDir = resolve(templatesDir, "nested");
    await mkdir(nestedDir, {
      recursive: true,
    });
    await writeFile(resolve(nestedDir, "SOUL.md"), "nested");

    try {
      await loadRuntimeConfig(
        {
          ALLOWED_CHANNEL_IDS: "111",
          LUNA_HOME: lunaHomeDir,
          DISCORD_BOT_TOKEN: "token",
        },
        {
          templatesDir,
        },
      );

      expect(await exists(resolve(lunaHomeDir, "workspace", "LUNA.md"))).toBe(true);
      expect(await exists(resolve(lunaHomeDir, "workspace", "nested"))).toBe(false);
    } finally {
      await rm(lunaHomeDir, {
        force: true,
        recursive: true,
      });
      await rm(templatesDir, {
        force: true,
        recursive: true,
      });
    }
  });

  it("templates ディレクトリが存在しない場合は失敗する", async () => {
    const lunaHomeDir = createTempLunaHomeDir();
    const missingTemplatesDir = createTempLunaHomeDir();
    try {
      await expect(
        loadRuntimeConfig(
          {
            ALLOWED_CHANNEL_IDS: "111",
            LUNA_HOME: lunaHomeDir,
            DISCORD_BOT_TOKEN: "token",
          },
          {
            templatesDir: missingTemplatesDir,
          },
        ),
      ).rejects.toThrowError(RuntimeConfigError);
    } finally {
      await rm(lunaHomeDir, {
        force: true,
        recursive: true,
      });
    }
  });

  it("workspace の同名パスがファイル以外なら失敗する", async () => {
    const lunaHomeDir = createTempLunaHomeDir();
    const workspaceDir = resolve(lunaHomeDir, "workspace");
    const templatesDir = await createTempTemplatesDir({
      "LUNA.md": "LUNA template",
    });
    await mkdir(resolve(workspaceDir, "LUNA.md"), {
      recursive: true,
    });

    try {
      await expect(
        loadRuntimeConfig(
          {
            ALLOWED_CHANNEL_IDS: "111",
            LUNA_HOME: lunaHomeDir,
            DISCORD_BOT_TOKEN: "token",
          },
          {
            templatesDir,
          },
        ),
      ).rejects.toThrowError(RuntimeConfigError);
    } finally {
      await rm(lunaHomeDir, {
        force: true,
        recursive: true,
      });
      await rm(templatesDir, {
        force: true,
        recursive: true,
      });
    }
  });

  it("ALLOWED_CHANNEL_IDS が空なら失敗する", async () => {
    await expect(
      loadRuntimeConfig({
        ALLOWED_CHANNEL_IDS: " ,  ",
        DISCORD_BOT_TOKEN: "token",
      }),
    ).rejects.toThrowError(RuntimeConfigError);
  });

  it("DISCORD_BOT_TOKEN がなければ失敗する", async () => {
    await expect(
      loadRuntimeConfig({
        ALLOWED_CHANNEL_IDS: "111",
      }),
    ).rejects.toThrowError(RuntimeConfigError);
  });
});

function createTempLunaHomeDir(): string {
  return resolve(join(tmpdir(), `luna-runtime-config-${Date.now()}-${Math.random().toString(16)}`));
}

async function createTempTemplatesDir(files: Record<string, string>): Promise<string> {
  const templatesDir = resolve(
    join(tmpdir(), `luna-runtime-config-templates-${Date.now()}-${Math.random().toString(16)}`),
  );
  await mkdir(templatesDir, {
    recursive: true,
  });
  await Promise.all(
    Object.entries(files).map(async ([fileName, content]) => {
      await writeFile(resolve(templatesDir, fileName), content);
    }),
  );

  return templatesDir;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
