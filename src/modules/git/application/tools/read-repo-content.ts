import type { GitCommandGateway } from "../../ports/outbound/git-command-gateway-port";
import { normalizeRepoUrl, resolveRepoDir } from "../resolve-repo-url";

const MAX_FILES = 50;

export type ReadRepoContentResult = {
  repoUrl: string;
  action: "cloned" | "pulled";
  path: string | undefined;
  files: Array<{ path: string; content: string }>;
  skippedFiles: string[];
  totalTrackedFiles: number;
};

export async function readRepoContentTool(input: {
  gateway: GitCommandGateway;
  repoUrl: string;
  path?: string;
  workspaceDir: string;
}): Promise<ReadRepoContentResult> {
  const repoUrl = normalizeRepoUrl(input.repoUrl);
  const localDir = resolveRepoDir(input.workspaceDir, repoUrl);

  const { action } = await input.gateway.cloneOrPull({
    repoUrl,
    localDir,
  });

  const allFiles = await input.gateway.listTrackedFiles({ localDir });
  const filtered = input.path
    ? allFiles.filter((f) => f.startsWith(input.path!))
    : allFiles;
  const targetFiles = filtered.slice(0, MAX_FILES);

  const files: Array<{ path: string; content: string }> = [];
  const skippedFiles: string[] = [];

  await Promise.all(
    targetFiles.map(async (filePath) => {
      const content = await input.gateway.readFileContent({
        localDir,
        filePath,
      });
      if (content !== null) {
        files.push({ path: filePath, content });
      } else {
        skippedFiles.push(filePath);
      }
    }),
  );

  files.sort((a, b) => a.path.localeCompare(b.path));
  skippedFiles.sort();

  if (filtered.length > MAX_FILES) {
    const overflow = filtered.slice(MAX_FILES);
    for (const f of overflow) {
      skippedFiles.push(f);
    }
  }

  return {
    repoUrl,
    action,
    path: input.path,
    files,
    skippedFiles,
    totalTrackedFiles: allFiles.length,
  };
}
