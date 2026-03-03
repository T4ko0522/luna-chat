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
import { dirname, join, resolve } from "node:path";

import { parseTOML, stringifyTOML } from "confbox";
import { CronTime } from "cron";
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
const DEFAULT_HEARTBEAT_CRON_TIME = "0 0,30 * * * *";

const ReasoningEffortSchema = z.union([
  z.literal("none"),
  z.literal("minimal"),
  z.literal("low"),
  z.literal("medium"),
  z.literal("high"),
  z.literal("xhigh"),
]);

type RuntimeSettings = {
  time_zone?: string;
  discord: {
    allowed_channel_ids: string[];
    allow_dm: boolean;
  };
  ai: {
    model: string;
    reasoning_effort: ReasoningEffort;
  };
  heartbeat: {
    cron_time: string;
  };
  admin: {
    user_ids: string[];
  };
  blacklist: {
    user_ids: string[];
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
  heartbeat: {
    cron_time: DEFAULT_HEARTBEAT_CRON_TIME,
  },
  admin: {
    user_ids: [],
  },
  blacklist: {
    user_ids: [],
  },
};

const RuntimeSettingsSchema = z.looseObject({
  time_zone: z.string().trim().min(1).optional(),
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
  heartbeat: z
    .looseObject({
      cron_time: z.string().trim().min(1).default(DEFAULT_HEARTBEAT_CRON_TIME),
    })
    .default(DEFAULT_RUNTIME_SETTINGS.heartbeat),
  admin: z
    .looseObject({
      user_ids: z.array(z.string()).default([]),
    })
    .default(DEFAULT_RUNTIME_SETTINGS.admin),
  blacklist: z
    .looseObject({
      user_ids: z.array(z.string()).default([]),
    })
    .default(DEFAULT_RUNTIME_SETTINGS.blacklist),
});

export type RuntimeConfig = {
  discordBotToken: string;
  allowedChannelIds: ReadonlySet<string>;
  allowDm: boolean;
  aiModel: string;
  aiReasoningEffort: ReasoningEffort;
  heartbeatCronTime: string;
  timeZone: string | undefined;
  lunaHomeDir: string;
  codexHomeDir: string;
  codexWorkspaceDir: string;
  logsDir: string;
  adminUserIds: ReadonlySet<string>;
  blacklistedUserIds: ReadonlySet<string>;
  configFilePath: string;
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
    heartbeatCronTime: runtimeSettings.heartbeatCronTime,
    timeZone: runtimeSettings.timeZone,
    lunaHomeDir,
    codexHomeDir,
    codexWorkspaceDir,
    logsDir,
    discordBotToken,
    adminUserIds: runtimeSettings.adminUserIds,
    blacklistedUserIds: runtimeSettings.blacklistedUserIds,
    configFilePath: configPath,
  };
}

function parseRuntimeSettingsFromConfig(rawConfig: unknown): {
  allowedChannelIds: ReadonlySet<string>;
  allowDm: boolean;
  aiModel: string;
  aiReasoningEffort: ReasoningEffort;
  heartbeatCronTime: string;
  timeZone: string | undefined;
  adminUserIds: ReadonlySet<string>;
  blacklistedUserIds: ReadonlySet<string>;
} {
  const parseResult = RuntimeSettingsSchema.safeParse(rawConfig);
  if (!parseResult.success) {
    throw new RuntimeConfigError(
      "config.toml must define [discord].allowed_channel_ids as an array of strings, optional [discord].allow_dm as a boolean, optional [ai].model/[ai].reasoning_effort, optional [heartbeat].cron_time, and optional top-level time_zone.",
    );
  }
  if (hasDeprecatedHeartbeatTimeZone(rawConfig)) {
    throw new RuntimeConfigError(
      "config.toml no longer supports [heartbeat].time_zone. Use top-level time_zone instead.",
    );
  }

  const allowedChannelIds = parseResult.data.discord.allowed_channel_ids
    .map((channelId) => channelId.trim())
    .filter((channelId) => channelId.length > 0);
  const heartbeatCronTime = parseResult.data.heartbeat.cron_time;
  const timeZone = parseResult.data.time_zone;
  validateHeartbeatSchedule(heartbeatCronTime, timeZone);

  const adminUserIds = parseResult.data.admin.user_ids
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
  const blacklistedUserIds = parseResult.data.blacklist.user_ids
    .map((id) => id.trim())
    .filter((id) => id.length > 0);

  return {
    allowedChannelIds: new Set(allowedChannelIds),
    allowDm: parseResult.data.discord.allow_dm,
    aiModel: parseResult.data.ai.model,
    aiReasoningEffort: parseResult.data.ai.reasoning_effort,
    heartbeatCronTime,
    timeZone,
    adminUserIds: new Set(adminUserIds),
    blacklistedUserIds: new Set(blacklistedUserIds),
  };
}

function validateHeartbeatSchedule(cronTime: string, timeZone: string | undefined): void {
  try {
    new CronTime(cronTime, timeZone);
  } catch {
    throw new RuntimeConfigError(
      "config.toml has invalid schedule settings: [heartbeat].cron_time must be a valid cron expression and top-level time_zone must be a valid IANA time zone when specified.",
    );
  }
}

function hasDeprecatedHeartbeatTimeZone(rawConfig: unknown): boolean {
  if (!isRecord(rawConfig)) {
    return false;
  }
  const heartbeat = rawConfig["heartbeat"];
  if (!isRecord(heartbeat)) {
    return false;
  }

  return Object.hasOwn(heartbeat, "time_zone");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
    templateFiles.map(async (relativeFilePath) => {
      const sourcePath = resolve(templatesDir, relativeFilePath);
      const destinationPath = resolve(workspaceDir, relativeFilePath);
      await ensureTemplateDestinationParentDirectory(destinationPath);
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
        throw new RuntimeConfigError(`failed to copy template file: ${relativeFilePath}`);
      }
    }),
  );
}

async function ensureTemplateDestinationParentDirectory(destinationPath: string): Promise<void> {
  const destinationParentDir = dirname(destinationPath);
  try {
    await mkdir(destinationParentDir, {
      recursive: true,
    });
    if (!(await stat(destinationParentDir)).isDirectory()) {
      throw new RuntimeConfigError(
        `workspace template destination parent must be a directory: ${destinationParentDir}`,
      );
    }
  } catch (error: unknown) {
    if (error instanceof RuntimeConfigError) {
      throw error;
    }
    throw new RuntimeConfigError(
      `failed to prepare workspace template destination directory: ${destinationParentDir}`,
    );
  }
}

async function listTemplateFiles(templatesDir: string): Promise<string[]> {
  try {
    const files = await listTemplateFilesRecursively(templatesDir, "");
    return files.sort();
  } catch (error: unknown) {
    if (error instanceof RuntimeConfigError) {
      throw error;
    }
    throw new RuntimeConfigError("templates directory must be readable.");
  }
}

async function listTemplateFilesRecursively(
  templatesDir: string,
  relativeDir: string,
): Promise<string[]> {
  const currentDir = relativeDir.length === 0 ? templatesDir : resolve(templatesDir, relativeDir);
  const entries = await readdir(currentDir, {
    withFileTypes: true,
  });

  const files: string[] = [];
  for (const entry of entries) {
    const relativePath = relativeDir.length === 0 ? entry.name : join(relativeDir, entry.name);
    const absolutePath = resolve(templatesDir, relativePath);

    if (entry.isSymbolicLink()) {
      throw new RuntimeConfigError(
        `templates directory must not include symbolic links: ${absolutePath}`,
      );
    }
    if (entry.isDirectory()) {
      const nestedFiles = await listTemplateFilesRecursively(templatesDir, relativePath);
      files.push(...nestedFiles);
      continue;
    }
    if (entry.isFile()) {
      files.push(relativePath);
    }
  }

  return files;
}

async function detectPathType(path: string): Promise<"missing" | "file" | "non-file"> {
  try {
    const stats = await stat(path);
    return stats.isFile() ? "file" : "non-file";
  } catch {
    return "missing";
  }
}

export async function updateBlacklistInConfigToml(
  configFilePath: string,
  userIds: string[],
): Promise<void> {
  const config = await loadConfigToml(configFilePath);
  const updatedConfig = isRecord(config) ? { ...config } : {};
  updatedConfig["blacklist"] = { user_ids: userIds };
  await writeFile(configFilePath, stringifyTOML(updatedConfig));
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
