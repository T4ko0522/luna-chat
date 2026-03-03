import { describe, expect, it, vi } from "vitest";

import type { GitCommandGateway } from "../../ports/outbound/git-command-gateway-port";

import { getRepoDailyChangesTool } from "./get-repo-daily-changes";

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

describe("getRepoDailyChangesTool", () => {
  it("HTTPS URLでcloneしてログを返す", async () => {
    const gateway = createGatewayStub({
      cloneOrPull: vi.fn(async () => ({ action: "pulled" as const })),
      logSince: vi.fn(async () => [
        {
          hash: "abc1234",
          authorName: "Alice",
          date: "2026-03-04T10:00:00+09:00",
          subject: "feat: add feature",
        },
      ]),
    });

    const result = await getRepoDailyChangesTool({
      gateway,
      repoUrl: "https://github.com/owner/repo",
      since: "2026-03-04",
      workspaceDir: "/tmp/workspace",
    });

    expect(result.repoUrl).toBe("https://github.com/owner/repo");
    expect(result.action).toBe("pulled");
    expect(result.since).toBe("2026-03-04");
    expect(result.commits).toHaveLength(1);
    expect(result.commits[0]).toMatchSnapshot();

    expect(gateway.cloneOrPull).toHaveBeenCalledWith({
      repoUrl: "https://github.com/owner/repo",
      localDir: expect.stringContaining("repos/repo-"),
    });
    expect(gateway.logSince).toHaveBeenCalledWith({
      localDir: expect.stringContaining("repos/repo-"),
      since: "2026-03-04",
    });
  });

  it("owner/repo形式をGitHub URLに展開する", async () => {
    const gateway = createGatewayStub();

    const result = await getRepoDailyChangesTool({
      gateway,
      repoUrl: "t4ko0522/luna-chat",
      since: "2026-03-04",
      workspaceDir: "/tmp/workspace",
    });

    expect(result.repoUrl).toBe("https://github.com/t4ko0522/luna-chat");
    expect(gateway.cloneOrPull).toHaveBeenCalledWith({
      repoUrl: "https://github.com/t4ko0522/luna-chat",
      localDir: expect.stringContaining("repos/luna-chat-"),
    });
  });

  it("SSH URLを拒否する", async () => {
    const gateway = createGatewayStub();

    await expect(
      getRepoDailyChangesTool({
        gateway,
        repoUrl: "git@github.com:owner/repo.git",
        workspaceDir: "/tmp/workspace",
      }),
    ).rejects.toThrow("owner/repo 形式");
  });

  it("ローカルパスを拒否する", async () => {
    const gateway = createGatewayStub();

    await expect(
      getRepoDailyChangesTool({
        gateway,
        repoUrl: "/path/to/repo",
        workspaceDir: "/tmp/workspace",
      }),
    ).rejects.toThrow("owner/repo 形式");
  });

  it("since未指定時は当日の日付を使う", async () => {
    const gateway = createGatewayStub();

    await getRepoDailyChangesTool({
      gateway,
      repoUrl: "https://github.com/owner/repo",
      workspaceDir: "/tmp/workspace",
    });

    expect(gateway.logSince).toHaveBeenCalledWith(
      expect.objectContaining({
        since: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      }),
    );
  });

  it(".git付きURLでもディレクトリ名を正しく解決する", async () => {
    const gateway = createGatewayStub();

    await getRepoDailyChangesTool({
      gateway,
      repoUrl: "https://github.com/owner/my-repo.git",
      since: "2026-03-04",
      workspaceDir: "/tmp/workspace",
    });

    expect(gateway.cloneOrPull).toHaveBeenCalledWith({
      repoUrl: "https://github.com/owner/my-repo.git",
      localDir: expect.stringContaining("repos/my-repo-"),
    });
  });
});
