import { describe, expect, it, vi } from "vitest";

import { createDiscordRestHistoryGateway } from "./discord-rest-history-gateway";

describe("createDiscordRestHistoryGateway", () => {
  it("Discordオブジェクトから各サマリーを正規化する", async () => {
    const gateway = createDiscordRestHistoryGateway({
      channels: {
        fetch: vi.fn(async () => {
          return {
            guildId: "guild-1",
            id: "channel-1",
            name: "general",
          };
        }),
      },
      guilds: {
        fetch: vi.fn(async (guildId: string) => {
          if (guildId === "guild-1") {
            return {
              id: "guild-1",
              members: {
                fetch: vi.fn(async () => {
                  return {
                    joinedAt: new Date("2026-01-01T00:00:00.000Z"),
                    nickname: "nick-name",
                    user: {
                      avatar: null,
                      banner: "banner",
                      bot: true,
                      globalName: "Global Name",
                      id: "user-1",
                      username: "user-name",
                    },
                  };
                }),
              },
              name: "Guild Name",
            };
          }
          return null;
        }),
      },
      users: {
        fetch: vi.fn(async () => {
          return {
            avatar: null,
            banner: "banner",
            bot: true,
            globalName: "Global Name",
            id: "user-1",
            username: "user-name",
          };
        }),
      },
    });

    await expect(gateway.fetchChannelById("channel-1")).resolves.toEqual({
      guildId: "guild-1",
      id: "channel-1",
      name: "general",
    });
    await expect(gateway.fetchGuildById("guild-1")).resolves.toEqual({
      id: "guild-1",
      name: "Guild Name",
    });
    await expect(gateway.fetchUserById("user-1")).resolves.toEqual({
      avatar: null,
      banner: "banner",
      bot: true,
      globalName: "Global Name",
      id: "user-1",
      username: "user-name",
    });
    await expect(
      gateway.fetchGuildMemberByUserId({
        guildId: "guild-1",
        userId: "user-1",
      }),
    ).resolves.toEqual({
      guildId: "guild-1",
      joinedAt: "2026-01-01T00:00:00.000Z",
      nickname: "nick-name",
      user: {
        avatar: null,
        banner: "banner",
        bot: true,
        globalName: "Global Name",
        id: "user-1",
        username: "user-name",
      },
    });
  });

  it("403/404 のときは null を返して継続する", async () => {
    const gateway = createDiscordRestHistoryGateway({
      channels: {
        fetch: vi.fn(async () => {
          throw {
            status: 403,
          };
        }),
      },
      guilds: {
        fetch: vi.fn(async () => {
          throw {
            status: 403,
          };
        }),
      },
      users: {
        fetch: vi.fn(async () => {
          throw {
            status: 403,
          };
        }),
      },
    });

    await expect(gateway.fetchChannelById("channel-1")).resolves.toBeNull();
    await expect(gateway.fetchGuildById("guild-1")).resolves.toBeNull();
    await expect(gateway.fetchUserById("user-1")).resolves.toBeNull();
    await expect(
      gateway.fetchGuildMemberByUserId({
        guildId: "guild-1",
        userId: "user-1",
      }),
    ).resolves.toBeNull();
  });

  it("403/404 以外のエラーは再送出する", async () => {
    const gateway = createDiscordRestHistoryGateway({
      channels: {
        fetch: vi.fn(async () => null),
      },
      guilds: {
        fetch: vi.fn(async () => null),
      },
      users: {
        fetch: vi.fn(async () => {
          throw new Error("boom");
        }),
      },
    });

    await expect(gateway.fetchUserById("user-1")).rejects.toThrow("boom");
  });

  it.each([
    {
      cursor: {
        beforeMessageId: "before-1",
      },
      expected: {
        before: "before-1",
      },
      title: "beforeMessageId",
    },
    {
      cursor: {
        afterMessageId: "after-1",
      },
      expected: {
        after: "after-1",
      },
      title: "afterMessageId",
    },
    {
      cursor: {
        aroundMessageId: "around-1",
      },
      expected: {
        around: "around-1",
      },
      title: "aroundMessageId",
    },
  ])("fetchMessages は $title を Discord API 引数へ反映する", async ({ cursor, expected }) => {
    const fetchMessages = vi.fn(async () => new Map<string, unknown>());
    const gateway = createDiscordRestHistoryGateway({
      channels: {
        fetch: vi.fn(async () => createHistoryReadableChannel(fetchMessages)),
      },
      guilds: {
        fetch: vi.fn(async () => null),
      },
      users: {
        fetch: vi.fn(async () => null),
      },
    });

    await gateway.fetchMessages({
      channelId: "channel-1",
      limit: 30,
      ...cursor,
    });

    expect(fetchMessages).toHaveBeenCalledWith({
      cache: false,
      limit: 30,
      ...expected,
    });
  });

  it("fetchMessages は作成日時の降順で返す", async () => {
    const fetchMessages = vi.fn(async () => {
      return new Map<string, unknown>([
        [
          "old",
          createRawMessage({
            authorId: "user-1",
            authorName: "Alice",
            createdAt: "2026-01-01T00:00:00.000Z",
            createdTimestamp: 1,
            id: "old",
          }),
        ],
        [
          "new",
          createRawMessage({
            authorId: "user-2",
            authorName: "Bob",
            createdAt: "2026-01-01T00:01:00.000Z",
            createdTimestamp: 2,
            id: "new",
          }),
        ],
      ]);
    });
    const gateway = createDiscordRestHistoryGateway({
      channels: {
        fetch: vi.fn(async () => createHistoryReadableChannel(fetchMessages)),
      },
      guilds: {
        fetch: vi.fn(async () => null),
      },
      users: {
        fetch: vi.fn(async () => null),
      },
    });

    await expect(
      gateway.fetchMessages({
        channelId: "channel-1",
        limit: 30,
      }),
    ).resolves.toMatchObject([{ id: "new" }, { id: "old" }]);
  });
});

function createHistoryReadableChannel(fetchMessages: (input: unknown) => Promise<unknown>) {
  return {
    isTextBased: () => true,
    messages: {
      fetch: fetchMessages,
    },
  };
}

function createRawMessage(input: {
  authorId: string;
  authorName: string;
  createdAt: string;
  createdTimestamp: number;
  id: string;
}) {
  return {
    attachments: new Map<string, unknown>(),
    author: {
      bot: false,
      id: input.authorId,
      username: input.authorName,
    },
    content: `${input.id} content`,
    createdAt: new Date(input.createdAt),
    createdTimestamp: input.createdTimestamp,
    id: input.id,
    reactions: new Map<string, unknown>(),
  };
}
