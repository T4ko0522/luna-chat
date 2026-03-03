import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";

import type {
  GitCommandGateway,
  GitCommitEntry,
} from "../../ports/outbound/git-command-gateway-port";

const TIMEOUT_MS = 30_000;
const SHALLOW_DEPTH = 50;
const LOG_FORMAT = "%H%x00%an%x00%aI%x00%s";
const MAX_FILE_SIZE = 100 * 1024;

export function createChildProcessGitCommandGateway(): GitCommandGateway {
  return {
    cloneOrPull: async (input) => {
      const isExisting = await isGitRepo(input.localDir);

      if (isExisting) {
        await execGit(["pull", "--ff-only"], { cwd: input.localDir });
        return { action: "pulled" };
      }

      await execGit(
        ["clone", "--depth", String(SHALLOW_DEPTH), input.repoUrl, input.localDir],
        {},
      );
      return { action: "cloned" };
    },
    logSince: async (input) => {
      const stdout = await execGit(
        [
          "log",
          `--format=${LOG_FORMAT}`,
          "--no-merges",
          `--since=${input.since}`,
        ],
        { cwd: input.localDir },
      );

      return parseGitLog(stdout);
    },
    listTrackedFiles: async (input) => {
      const stdout = await execGit(["ls-files"], { cwd: input.localDir });
      const trimmed = stdout.trim();
      if (trimmed.length === 0) {
        return [];
      }
      return trimmed.split("\n");
    },
    readFileContent: async (input) => {
      const fullPath = resolve(input.localDir, input.filePath);
      const normalizedBase = resolve(input.localDir);
      if (!fullPath.startsWith(`${normalizedBase}/`)) {
        return null;
      }
      try {
        const stats = await stat(fullPath);
        if (!stats.isFile() || stats.size > MAX_FILE_SIZE) {
          return null;
        }
        return await readFile(fullPath, "utf8");
      } catch {
        return null;
      }
    },
  };
}

async function isGitRepo(dir: string): Promise<boolean> {
  try {
    const gitDir = resolve(dir, ".git");
    const stats = await stat(gitDir);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

function execGit(
  args: string[],
  options: { cwd?: string },
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      {
        cwd: options.cwd,
        timeout: TIMEOUT_MS,
        maxBuffer: 10 * 1024 * 1024,
      },
      (error, stdout) => {
        if (error) {
          reject(new Error(`git ${args[0]} failed: ${error.message}`));
          return;
        }
        resolve(stdout);
      },
    );
  });
}

function parseGitLog(stdout: string): GitCommitEntry[] {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) {
    return [];
  }

  return trimmed.split("\n").map((line) => {
    const parts = line.split("\0");
    if (parts.length < 4) {
      throw new Error(`Unexpected git log format: ${line}`);
    }
    return {
      hash: parts[0]!,
      authorName: parts[1]!,
      date: parts[2]!,
      subject: parts[3]!,
    };
  });
}
