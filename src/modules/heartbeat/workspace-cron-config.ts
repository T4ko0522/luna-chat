import { readFile, writeFile } from "node:fs/promises";

import { parseTOML, stringifyTOML } from "confbox";
import { CronTime } from "cron";
import { z } from "zod";

export const WORKSPACE_CRON_CONFIG_FILE_NAME = "cron.toml";

const WorkspaceCronJobSchema = z.looseObject({
  cron: z.string().trim().min(1),
  prompt: z.string().trim().min(1),
  oneshot: z.boolean().default(false),
});

const WorkspaceCronConfigSchema = z.looseObject({
  jobs: z.record(z.string(), WorkspaceCronJobSchema).default({}),
});

type WorkspaceCronConfigSchemaResult = z.infer<typeof WorkspaceCronConfigSchema>;

type WorkspaceCronTomlDocument = {
  jobs: Record<
    string,
    {
      cron: string;
      prompt: string;
      oneshot: boolean;
    }
  >;
};

export type WorkspaceCronJob = {
  id: string;
  cronTime: string;
  prompt: string;
  oneshot: boolean;
};

export type WorkspaceCronConfig = {
  jobs: ReadonlyArray<WorkspaceCronJob>;
};

export class WorkspaceCronConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceCronConfigError";
  }
}

export async function loadWorkspaceCronConfig(
  configPath: string,
  timeZone: string | undefined,
): Promise<WorkspaceCronConfig> {
  let rawToml: string;
  try {
    rawToml = await readFile(configPath, "utf8");
  } catch (error: unknown) {
    if (hasNodeErrorCode(error, "ENOENT")) {
      return {
        jobs: [],
      };
    }
    throw new WorkspaceCronConfigError("cron.toml must be readable.");
  }

  let rawConfig: unknown;
  try {
    rawConfig = parseTOML(rawToml);
  } catch {
    throw new WorkspaceCronConfigError("cron.toml is invalid TOML.");
  }

  return parseWorkspaceCronConfig(rawConfig, timeZone);
}

export async function removeWorkspaceCronJob(configPath: string, jobId: string): Promise<boolean> {
  const config = await loadWorkspaceCronConfig(configPath, undefined);
  const remainingJobs = config.jobs.filter((job) => {
    return job.id !== jobId;
  });
  if (remainingJobs.length === config.jobs.length) {
    return false;
  }

  await writeFile(configPath, stringifyWorkspaceCronConfig({ jobs: remainingJobs }));
  return true;
}

export function parseWorkspaceCronConfig(
  rawConfig: unknown,
  timeZone: string | undefined,
): WorkspaceCronConfig {
  const parseResult = WorkspaceCronConfigSchema.safeParse(rawConfig);
  if (!parseResult.success) {
    throw new WorkspaceCronConfigError(
      "cron.toml must define [jobs.<id>] with cron (string), prompt (string), and optional oneshot (boolean).",
    );
  }

  return toWorkspaceCronConfig(parseResult.data, timeZone);
}

export function stringifyWorkspaceCronConfig(config: WorkspaceCronConfig): string {
  const sortedJobs = [...config.jobs].sort((left, right) => {
    return left.id.localeCompare(right.id);
  });
  const tomlDocument: WorkspaceCronTomlDocument = {
    jobs: {},
  };
  for (const job of sortedJobs) {
    tomlDocument.jobs[job.id] = {
      cron: job.cronTime,
      oneshot: job.oneshot,
      prompt: job.prompt,
    };
  }

  return stringifyTOML(tomlDocument);
}

function toWorkspaceCronConfig(
  parsedConfig: WorkspaceCronConfigSchemaResult,
  timeZone: string | undefined,
): WorkspaceCronConfig {
  const jobs = Object.entries(parsedConfig.jobs)
    .map(([id, job]) => {
      validateCronTime(id, job.cron, timeZone);
      return {
        cronTime: job.cron,
        id,
        oneshot: job.oneshot,
        prompt: job.prompt,
      };
    })
    .sort((left, right) => {
      return left.id.localeCompare(right.id);
    });

  return {
    jobs,
  };
}

function validateCronTime(jobId: string, cronTime: string, timeZone: string | undefined): void {
  try {
    new CronTime(cronTime, timeZone);
  } catch {
    throw new WorkspaceCronConfigError(
      `cron.toml has invalid cron for jobs.${jobId}.cron: must be a valid cron expression for the configured time zone.`,
    );
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
