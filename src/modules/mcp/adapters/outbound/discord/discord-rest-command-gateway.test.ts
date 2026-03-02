import { describe, expect, it, vi } from "vitest";

import { createDiscordRestCommandGateway } from "./discord-rest-command-gateway";

describe("createDiscordRestCommandGateway", () => {
  it("channelId 指定時はそのまま解決する", async () => {
    const gateway = createDiscordRestCommandGateway(createClientStub());

    await expect(
      gateway.resolveChannelId({
        channelId: " channel-1 ",
      }),
    ).resolves.toBe("channel-1");
  });

  it("userId 指定時は DM チャンネルを作成して解決する", async () => {
    const client = createClientStub();
    const gateway = createDiscordRestCommandGateway(client);

    await expect(
      gateway.resolveChannelId({
        userId: " user-1 ",
      }),
    ).resolves.toBe("dm-channel-1");
    expect(client.users.createDM).toHaveBeenCalledWith("user-1");
  });

  it("空文字の userId はエラー", async () => {
    const gateway = createDiscordRestCommandGateway(createClientStub());

    await expect(
      gateway.resolveChannelId({
        userId: "   ",
      }),
    ).rejects.toThrow("userId must not be empty.");
  });

  it("通常メッセージを送信する", async () => {
    const client = createClientStub();
    const gateway = createDiscordRestCommandGateway(client);

    await expect(
      gateway.sendMessage({
        channelId: "channel-1",
        text: "  hello  ",
      }),
    ).resolves.toEqual({
      ok: true,
    });

    expect(client.channels.fetch).toHaveBeenCalledWith("channel-1");
    expect(client.channel.send).toHaveBeenCalledWith({
      allowedMentions: {
        parse: [],
      },
      content: "hello",
    });
  });

  it("返信メッセージを送信する", async () => {
    const client = createClientStub();
    const gateway = createDiscordRestCommandGateway(client);

    await gateway.sendMessage({
      channelId: "channel-1",
      replyToMessageId: " reply-1 ",
      text: "hello",
    });

    expect(client.channel.send).toHaveBeenCalledWith({
      allowedMentions: {
        parse: [],
        repliedUser: true,
      },
      content: "hello",
      reply: {
        failIfNotExists: false,
        messageReference: "reply-1",
      },
    });
  });

  it("リアクションを付与する", async () => {
    const client = createClientStub();
    const gateway = createDiscordRestCommandGateway(client);

    await expect(
      gateway.addReaction({
        channelId: "channel-1",
        emoji: " 🎉 ",
        messageId: "message-1",
      }),
    ).resolves.toEqual({
      ok: true,
    });
    expect(client.channel.messages.react).toHaveBeenCalledWith("message-1", "🎉");
  });

  it("typing を送信する", async () => {
    const client = createClientStub();
    const gateway = createDiscordRestCommandGateway(client);

    await gateway.sendTyping("channel-1");
    expect(client.channel.sendTyping).toHaveBeenCalledTimes(1);
  });
});

function createClientStub() {
  const channel = {
    isTextBased: () => true,
    messages: {
      react: vi.fn(async () => undefined),
    },
    send: vi.fn(async () => undefined),
    sendTyping: vi.fn(async () => undefined),
  };
  return {
    channel,
    channels: {
      fetch: vi.fn(async () => channel),
    },
    users: {
      createDM: vi.fn(async () => ({
        id: "dm-channel-1",
      })),
    },
  };
}
