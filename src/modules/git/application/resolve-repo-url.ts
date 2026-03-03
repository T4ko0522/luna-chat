import { createHash } from "node:crypto";
import { resolve } from "node:path";

const HTTPS_URL_PATTERN = /^https:\/\//;
const GITHUB_SHORTHAND_PATTERN = /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/;
const DIR_NAME_SANITIZE_PATTERN = /[^a-zA-Z0-9._-]/g;
const HASH_LENGTH = 12;

export function normalizeRepoUrl(repoUrl: string): string {
  if (HTTPS_URL_PATTERN.test(repoUrl)) {
    return repoUrl;
  }

  if (GITHUB_SHORTHAND_PATTERN.test(repoUrl)) {
    return `https://github.com/${repoUrl}`;
  }

  throw new Error(
    "リポジトリURLはHTTPS形式または owner/repo 形式で指定してください。",
  );
}

export function resolveRepoDir(workspaceDir: string, repoUrl: string): string {
  const name = extractRepoName(repoUrl);
  const hash = createHash("sha256").update(repoUrl).digest("hex").slice(0, HASH_LENGTH);
  return resolve(workspaceDir, "repos", `${name}-${hash}`);
}

function extractRepoName(repoUrl: string): string {
  const url = new URL(repoUrl);
  const lastSegment = url.pathname.split("/").pop() ?? "repo";
  const name = lastSegment.replace(/\.git$/, "") || "repo";
  return name.replace(DIR_NAME_SANITIZE_PATTERN, "_");
}
