import {
  access,
  constants,
  copyFile,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";

import { parseTOML, stringifyTOML } from "confbox";
import { z } from "zod";

import type { ReasoningEffort } from "../ai/codex-generated/ReasoningEffort";

const DEFAULT_LUNA_HOME = "~/.luna";
const WORKSPACE_DIR_NAME = "workspace";
const CODEX_HOME_DIR_NAME = "codex";
const LOGS_DIR_NAME = "logs";
const DEFAULT_TEMPLATES_DIR_NAME = "templates";
const CONFIG_FILE_NAME = "config.toml";
const DEFAULT_AI_MODEL = "gpt-5.3-codex";
const DEFAULT_AI_REASONING_EFFORT: ReasoningEffort = "medium";

const ReasoningEffortSchema = z.union([
  z.literal("none"),
  z.literal("minimal"),
  z.literal("low"),
  z.literal("medium"),
  z.literal("high"),
  z.literal("xhigh"),
]);

type RuntimeSettings = {
  discord: {
    allowed_channel_ids: string[];
    allow_dm: boolean;
  };
  ai: {
    model: string;
    reasoning_effort: ReasoningEffort;
  };
};

const DEFAULT_RUNTIME_SETTINGS: RuntimeSettings = {
  discord: {
    allowed_channel_ids: [],
    allow_dm: false,
  },
  ai: {
    model: DEFAULT_AI_MODEL,
    reasoning_effort: DEFAULT_AI_REASONING_EFFORT,
  },
};

const RuntimeSettingsSchema = z.looseObject({
  discord: z.looseObject({
    allowed_channel_ids: z.array(z.string()),
    allow_dm: z.boolean().default(DEFAULT_RUNTIME_SETTINGS.discord.allow_dm),
  }),
  ai: z
    .looseObject({
      model: z.string().trim().min(1).default(DEFAULT_AI_MODEL),
      reasoning_effort: ReasoningEffortSchema.default(DEFAULT_AI_REASONING_EFFORT),
    })
    .default(DEFAULT_RUNTIME_SETTINGS.ai),
});

export type RuntimeConfig = {
  discordBotToken: string;
  allowedChannelIds: ReadonlySet<string>;
  allowDm: boolean;
  aiModel: string;
  aiReasoningEffort: ReasoningEffort;
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

  const lunaHomeDir = resolveLunaHome(env["LUNA_HOME"]);
  const codexWorkspaceDir = resolve(lunaHomeDir, WORKSPACE_DIR_NAME);
  const codexHomeDir = resolve(lunaHomeDir, CODEX_HOME_DIR_NAME);
  const logsDir = resolve(lunaHomeDir, LOGS_DIR_NAME);

  await ensureDirectoryReady(lunaHomeDir, "LUNA_HOME must be a writable directory.");
  await ensureDirectoryReady(codexWorkspaceDir, "workspace must be a writable directory.");
  await ensureDirectoryReady(codexHomeDir, "codex home must be a writable directory.");
  await ensureDirectoryReady(logsDir, "logs directory must be a writable directory.");
  const configPath = await ensureConfigFileExists(lunaHomeDir);
  const config = await loadConfigToml(configPath);
  const runtimeSettings = parseRuntimeSettingsFromConfig(config);
  await seedWorkspaceTemplatesIfMissing(
    codexWorkspaceDir,
    resolveTemplatesDir(options.templatesDir),
  );

  return {
    allowedChannelIds: runtimeSettings.allowedChannelIds,
    allowDm: runtimeSettings.allowDm,
    aiModel: runtimeSettings.aiModel,
    aiReasoningEffort: runtimeSettings.aiReasoningEffort,
    lunaHomeDir,
    codexHomeDir,
    codexWorkspaceDir,
    logsDir,
    discordBotToken,
  };
}

function parseRuntimeSettingsFromConfig(rawConfig: unknown): {
  allowedChannelIds: ReadonlySet<string>;
  allowDm: boolean;
  aiModel: string;
  aiReasoningEffort: ReasoningEffort;
} {
  const parseResult = RuntimeSettingsSchema.safeParse(rawConfig);
  if (!parseResult.success) {
    throw new RuntimeConfigError(
      "config.toml must define [discord].allowed_channel_ids as an array of strings, optional [discord].allow_dm as a boolean, and optional [ai].model/[ai].reasoning_effort.",
    );
  }

  const allowedChannelIds = parseResult.data.discord.allowed_channel_ids
    .map((channelId) => channelId.trim())
    .filter((channelId) => channelId.length > 0);

  return {
    allowedChannelIds: new Set(allowedChannelIds),
    allowDm: parseResult.data.discord.allow_dm,
    aiModel: parseResult.data.ai.model,
    aiReasoningEffort: parseResult.data.ai.reasoning_effort,
  };
}

async function ensureConfigFileExists(lunaHomeDir: string): Promise<string> {
  const configPath = resolve(lunaHomeDir, CONFIG_FILE_NAME);
  const configPathType = await detectPathType(configPath);

  if (configPathType === "file") {
    return configPath;
  }
  if (configPathType === "non-file") {
    throw new RuntimeConfigError("config.toml must be a file.");
  }

  try {
    await writeFile(configPath, stringifyTOML(DEFAULT_RUNTIME_SETTINGS), {
      flag: "wx",
    });
    return configPath;
  } catch (error: unknown) {
    if (hasNodeErrorCode(error, "EEXIST")) {
      return configPath;
    }
    throw new RuntimeConfigError("failed to create default config.toml.");
  }
}

async function loadConfigToml(configPath: string): Promise<unknown> {
  let rawConfigToml: string;
  try {
    rawConfigToml = await readFile(configPath, "utf8");
  } catch {
    throw new RuntimeConfigError("config.toml must be readable.");
  }

  try {
    return parseTOML(rawConfigToml);
  } catch {
    throw new RuntimeConfigError("config.toml is invalid TOML.");
  }
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

function hasNodeErrorCode(error: unknown, code: string): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  if (!("code" in error)) {
    return false;
  }
  return error.code === code;
}
