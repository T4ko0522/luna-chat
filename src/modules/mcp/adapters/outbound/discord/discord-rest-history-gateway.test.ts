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
});
