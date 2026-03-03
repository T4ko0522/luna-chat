import { describe, expect, it, vi } from "vitest";

import type { GitCommandGateway } from "../../ports/outbound/git-command-gateway-port";

import { readRepoContentTool } from "./read-repo-content";

function createGatewayStub(
  overrides: Partial<GitCommandGateway> = {},
): GitCommandGateway {
  return {
    cloneOrPull: vi.fn(async () => ({ action: "cloned" as const })),
    logSince: vi.fn(async () => []),
    listTrackedFiles: vi.fn(async () => []),
    readFileContent: vi.fn(async () => null),
    ...overrides,
  };
}

describe("readRepoContentTool", () => {
  it("リポジトリをクローンしてファイル内容を返す", async () => {
    const gateway = createGatewayStub({
      cloneOrPull: vi.fn(async () => ({ action: "pulled" as const })),
      listTrackedFiles: vi.fn(async () => [
        "src/index.ts",
        "src/utils.ts",
        "README.md",
      ]),
      readFileContent: vi.fn(async ({ filePath }) => {
        const contents: Record<string, string> = {
          "src/index.ts": "console.log('hello');",
          "src/utils.ts": "export const add = (a, b) => a + b;",
          "README.md": "# My Project",
        };
        return contents[filePath] ?? null;
      }),
    });

    const result = await readRepoContentTool({
      gateway,
      repoUrl: "https://github.com/owner/repo",
      workspaceDir: "/tmp/workspace",
    });

    expect(result.repoUrl).toBe("https://github.com/owner/repo");
    expect(result.action).toBe("pulled");
    expect(result.files).toHaveLength(3);
    expect(result.files[0]).toEqual({
      path: "README.md",
      content: "# My Project",
    });
    expect(result.skippedFiles).toHaveLength(0);
    expect(result.totalTrackedFiles).toBe(3);
  });

  it("pathフィルタで対象を絞り込める", async () => {
    const gateway = createGatewayStub({
      listTrackedFiles: vi.fn(async () => [
        "src/index.ts",
        "src/utils.ts",
        "README.md",
        "tests/index.test.ts",
      ]),
      readFileContent: vi.fn(async () => "content"),
    });

    const result = await readRepoContentTool({
      gateway,
      repoUrl: "https://github.com/owner/repo",
      path: "src/",
      workspaceDir: "/tmp/workspace",
    });

    expect(result.files).toHaveLength(2);
    expect(result.files.map((f) => f.path)).toEqual([
      "src/index.ts",
      "src/utils.ts",
    ]);
    expect(result.totalTrackedFiles).toBe(4);
  });

  it("読み取れないファイルをスキップリストに入れる", async () => {
    const gateway = createGatewayStub({
      listTrackedFiles: vi.fn(async () => [
        "src/index.ts",
        "binary.png",
      ]),
      readFileContent: vi.fn(async ({ filePath }) => {
        if (filePath === "binary.png") return null;
        return "code";
      }),
    });

    const result = await readRepoContentTool({
      gateway,
      repoUrl: "https://github.com/owner/repo",
      workspaceDir: "/tmp/workspace",
    });

    expect(result.files).toHaveLength(1);
    expect(result.skippedFiles).toEqual(["binary.png"]);
  });

  it("owner/repo形式をGitHub URLに展開する", async () => {
    const gateway = createGatewayStub({
      listTrackedFiles: vi.fn(async () => ["README.md"]),
      readFileContent: vi.fn(async () => "# Hello"),
    });

    const result = await readRepoContentTool({
      gateway,
      repoUrl: "owner/repo",
      workspaceDir: "/tmp/workspace",
    });

    expect(result.repoUrl).toBe("https://github.com/owner/repo");
    expect(gateway.cloneOrPull).toHaveBeenCalledWith({
      repoUrl: "https://github.com/owner/repo",
      localDir: expect.stringContaining("repos/repo-"),
    });
  });

  it("SSH URLを拒否する", async () => {
    const gateway = createGatewayStub();

    await expect(
      readRepoContentTool({
        gateway,
        repoUrl: "git@github.com:owner/repo.git",
        workspaceDir: "/tmp/workspace",
      }),
    ).rejects.toThrow("owner/repo 形式");
  });

  it("50件を超えるファイルはスキップされる", async () => {
    const files = Array.from({ length: 60 }, (_, i) => `file-${String(i).padStart(3, "0")}.ts`);
    const gateway = createGatewayStub({
      listTrackedFiles: vi.fn(async () => files),
      readFileContent: vi.fn(async () => "content"),
    });

    const result = await readRepoContentTool({
      gateway,
      repoUrl: "https://github.com/owner/repo",
      workspaceDir: "/tmp/workspace",
    });

    expect(result.files).toHaveLength(50);
    expect(result.skippedFiles).toHaveLength(10);
  });
});
