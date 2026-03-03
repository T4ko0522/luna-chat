import type {
  GitCommandGateway,
  GitCommitEntry,
} from "../../ports/outbound/git-command-gateway-port";
import { normalizeRepoUrl, resolveRepoDir } from "../resolve-repo-url";

export type GetRepoDailyChangesResult = {
  repoUrl: string;
  action: "cloned" | "pulled";
  since: string;
  commits: GitCommitEntry[];
};

export async function getRepoDailyChangesTool(input: {
  gateway: GitCommandGateway;
  repoUrl: string;
  since?: string;
  workspaceDir: string;
}): Promise<GetRepoDailyChangesResult> {
  const repoUrl = normalizeRepoUrl(input.repoUrl);
  const since = input.since ?? todayDateString();
  const localDir = resolveRepoDir(input.workspaceDir, repoUrl);

  const { action } = await input.gateway.cloneOrPull({
    repoUrl,
    localDir,
  });

  const commits = await input.gateway.logSince({
    localDir,
    since,
  });

  return {
    repoUrl,
    action,
    since,
    commits,
  };
}

function todayDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
