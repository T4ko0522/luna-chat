import { access, constants, copyFile, mkdir, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";

const DEFAULT_LUNA_HOME = "~/.luna";
const WORKSPACE_DIR_NAME = "workspace";
const CODEX_HOME_DIR_NAME = "codex";
const LOGS_DIR_NAME = "logs";
const DEFAULT_TEMPLATES_DIR_NAME = "templates";

export type RuntimeConfig = {
  discordBotToken: string;
  allowedChannelIds: ReadonlySet<string>;
  lunaHomeDir: string;
  codexHomeDir: string;
  codexWorkspaceDir: string;
  logsDir: string;
};

export class RuntimeConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuntimeConfigError";
  }
}

type LoadRuntimeConfigOptions = {
  templatesDir?: string;
};

export async function loadRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
  options: LoadRuntimeConfigOptions = {},
): Promise<RuntimeConfig> {
  const discordBotToken = env["DISCORD_BOT_TOKEN"]?.trim();
  if (!discordBotToken) {
    throw new RuntimeConfigError("DISCORD_BOT_TOKEN is required.");
  }

  const allowedChannelIds = parseAllowedChannelIds(env["ALLOWED_CHANNEL_IDS"]);
  const lunaHomeDir = resolveLunaHome(env["LUNA_HOME"]);
  const codexWorkspaceDir = resolve(lunaHomeDir, WORKSPACE_DIR_NAME);
  const codexHomeDir = resolve(lunaHomeDir, CODEX_HOME_DIR_NAME);
  const logsDir = resolve(lunaHomeDir, LOGS_DIR_NAME);

  await ensureDirectoryReady(lunaHomeDir, "LUNA_HOME must be a writable directory.");
  await ensureDirectoryReady(codexWorkspaceDir, "workspace must be a writable directory.");
  await ensureDirectoryReady(codexHomeDir, "codex home must be a writable directory.");
  await ensureDirectoryReady(logsDir, "logs directory must be a writable directory.");
  await seedWorkspaceTemplatesIfMissing(
    codexWorkspaceDir,
    resolveTemplatesDir(options.templatesDir),
  );

  return {
    allowedChannelIds,
    lunaHomeDir,
    codexHomeDir,
    codexWorkspaceDir,
    logsDir,
    discordBotToken,
  };
}

function parseAllowedChannelIds(rawAllowedChannelIds: string | undefined): ReadonlySet<string> {
  if (!rawAllowedChannelIds) {
    throw new RuntimeConfigError("ALLOWED_CHANNEL_IDS is required.");
  }

  const allowedChannelIds = rawAllowedChannelIds
    .split(",")
    .map((channelId) => channelId.trim())
    .filter((channelId) => channelId.length > 0);
  if (allowedChannelIds.length === 0) {
    throw new RuntimeConfigError("ALLOWED_CHANNEL_IDS must include at least one channel ID.");
  }

  return new Set(allowedChannelIds);
}

function resolveTemplatesDir(rawTemplatesDir: string | undefined): string {
  const configuredTemplatesDir = rawTemplatesDir?.trim();
  if (configuredTemplatesDir && configuredTemplatesDir.length > 0) {
    return resolve(configuredTemplatesDir);
  }

  return resolve(process.cwd(), DEFAULT_TEMPLATES_DIR_NAME);
}

function resolveLunaHome(rawLunaHome: string | undefined): string {
  const configuredLunaHome = rawLunaHome?.trim();
  const lunaHome =
    configuredLunaHome && configuredLunaHome.length > 0 ? configuredLunaHome : DEFAULT_LUNA_HOME;

  return resolve(expandHomeDirectory(lunaHome));
}

function expandHomeDirectory(path: string): string {
  if (path === "~") {
    return homedir();
  }
  if (path.startsWith("~/")) {
    return resolve(homedir(), path.slice(2));
  }

  return path;
}

async function ensureDirectoryReady(path: string, message: string): Promise<void> {
  try {
    await mkdir(path, {
      recursive: true,
    });
    if (!(await stat(path)).isDirectory()) {
      throw new RuntimeConfigError(message);
    }
    await access(path, constants.W_OK);
  } catch {
    throw new RuntimeConfigError(message);
  }
}

async function seedWorkspaceTemplatesIfMissing(
  workspaceDir: string,
  templatesDir: string,
): Promise<void> {
  const templateFiles = await listTemplateFiles(templatesDir);
  await Promise.all(
    templateFiles.map(async (fileName) => {
      const sourcePath = resolve(templatesDir, fileName);
      const destinationPath = resolve(workspaceDir, fileName);
      const destinationType = await detectPathType(destinationPath);

      if (destinationType === "file") {
        return;
      }
      if (destinationType === "non-file") {
        throw new RuntimeConfigError(
          `workspace template destination must be a file path: ${destinationPath}`,
        );
      }

      try {
        await copyFile(sourcePath, destinationPath, constants.COPYFILE_EXCL);
      } catch {
        throw new RuntimeConfigError(`failed to copy template file: ${fileName}`);
      }
    }),
  );
}

async function listTemplateFiles(templatesDir: string): Promise<string[]> {
  try {
    const entries = await readdir(templatesDir, {
      withFileTypes: true,
    });
    const files = entries
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort();

    if (files.length === 0) {
      throw new RuntimeConfigError("templates directory must include at least one file.");
    }

    return files;
  } catch (error: unknown) {
    if (error instanceof RuntimeConfigError) {
      throw error;
    }
    throw new RuntimeConfigError("templates directory must be readable.");
  }
}

async function detectPathType(path: string): Promise<"missing" | "file" | "non-file"> {
  try {
    const stats = await stat(path);
    return stats.isFile() ? "file" : "non-file";
  } catch {
    return "missing";
  }
}
