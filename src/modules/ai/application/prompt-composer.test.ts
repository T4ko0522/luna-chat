import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import type { RuntimeMessage } from "../../conversation/domain/runtime-message";
import type { DiscordPromptContext } from "../ports/inbound/ai-service-port";

import { buildHeartbeatPromptBundle, buildPromptBundle, buildSteerPrompt } from "./prompt-composer";

describe("buildPromptBundle", () => {
  it("instructions/developer/user role prompt を分離して生成する", async () => {
    await withWorkspaceDir(async (workspaceDir) => {
      const promptBundle = await buildPromptBundle(createInput(), workspaceDir);

      expect(promptBundle.instructions).toMatchSnapshot();
      expect(promptBundle.developerRolePrompt).toMatchSnapshot();
      expect(promptBundle.userRolePrompt).toMatchSnapshot();
      expect(promptBundle).toMatchSnapshot();

      expect(promptBundle.userRolePrompt).toContain("テスト本文");
      expect(promptBundle.userRolePrompt).not.toContain("forceReply");
      expect(promptBundle.userRolePrompt).toContain("新しいチャンネルメッセージです。");
      expect(promptBundle.userRolePrompt).not.toContain("以下は現在の入力情報です。");

      const recentMessagesIndex = promptBundle.userRolePrompt.indexOf("## 直近のメッセージ");
      const currentMessageIndex = promptBundle.userRolePrompt.indexOf("## 投稿されたメッセージ");
      expect(recentMessagesIndex).toBeGreaterThanOrEqual(0);
      expect(currentMessageIndex).toBeGreaterThan(recentMessagesIndex);
    });
  });

  it("返信メッセージがある場合は返信先情報を引用形式で含める", async () => {
    await withWorkspaceDir(async (workspaceDir) => {
      const input = createInput();
      input.currentMessage.replyTo = {
        authorId: "reply-author-id",
        authorIsBot: false,
        authorName: "reply-author-name",
        content: "返信先本文",
        createdAt: "2026-02-23 08:58:00 JST",
        id: "reply-message-id",
      };
      const promptBundle = await buildPromptBundle(input, workspaceDir);

      expect(promptBundle.userRolePrompt).not.toContain("返信先メッセージ:");
      expect(promptBundle.userRolePrompt).toContain(
        "> [2026-02-23 08:58:00 JST] reply-author-name (ID: reply-author-id) (Message ID: reply-message-id):",
      );
      expect(promptBundle.userRolePrompt).toContain("> 返信先本文");
      expect(promptBundle.userRolePrompt).toContain(
        "(Message ID: reply-message-id):\n> 返信先本文",
      );
      expect(promptBundle.userRolePrompt).toContain("(Message ID: message-id):\nテスト本文");
      expect(promptBundle.userRolePrompt).toMatch(/> 返信先本文\n\[2026-02-23 09:00:00 JST]/);
      expect(promptBundle.userRolePrompt).toMatchSnapshot();
    });
  });

  it("直近メッセージが複数ある場合は順序どおりにすべて含める", async () => {
    await withWorkspaceDir(async (workspaceDir) => {
      const input = createInput();
      input.recentMessages = [
        {
          authorId: "recent-author-id-1",
          authorIsBot: false,
          authorName: "recent-author-name-1",
          channelId: "channel-id",
          content: "直近メッセージ1",
          createdAt: "2026-02-23 08:56:00 JST",
          id: "recent-message-id-1",
          mentionedBot: false,
        },
        {
          authorId: "recent-author-id-2",
          authorIsBot: true,
          authorName: "recent-author-name-2",
          channelId: "channel-id",
          content: "直近メッセージ2",
          createdAt: "2026-02-23 08:57:00 JST",
          id: "recent-message-id-2",
          mentionedBot: false,
        },
        {
          authorId: "recent-author-id-3",
          authorIsBot: false,
          authorName: "recent-author-name-3",
          channelId: "channel-id",
          content: "直近メッセージ3",
          createdAt: "2026-02-23 08:58:00 JST",
          id: "recent-message-id-3",
          mentionedBot: false,
        },
        {
          authorId: "recent-author-id-4",
          authorIsBot: false,
          authorName: "recent-author-name-4",
          channelId: "channel-id",
          content: "直近メッセージ4",
          createdAt: "2026-02-23 08:59:00 JST",
          id: "recent-message-id-4",
          mentionedBot: false,
        },
      ];
      const promptBundle = await buildPromptBundle(input, workspaceDir);

      const firstIndex = promptBundle.userRolePrompt.indexOf("recent-message-id-1");
      const secondIndex = promptBundle.userRolePrompt.indexOf("recent-message-id-2");
      const thirdIndex = promptBundle.userRolePrompt.indexOf("recent-message-id-3");
      const fourthIndex = promptBundle.userRolePrompt.indexOf("recent-message-id-4");

      expect(firstIndex).toBeGreaterThanOrEqual(0);
      expect(secondIndex).toBeGreaterThan(firstIndex);
      expect(thirdIndex).toBeGreaterThan(secondIndex);
      expect(fourthIndex).toBeGreaterThan(thirdIndex);
      expect(promptBundle.userRolePrompt).toMatch(
        /recent-message-id-1\):\n直近メッセージ1\n\n\[2026-02-23 08:57:00 JST]/,
      );
      expect(promptBundle.userRolePrompt).toMatchSnapshot();
    });
  });

  it("返信先メッセージが複数箇所にある場合もすべて含める", async () => {
    await withWorkspaceDir(async (workspaceDir) => {
      const input = createInput();
      input.recentMessages = [
        {
          authorId: "recent-author-id-1",
          authorIsBot: false,
          authorName: "recent-author-name-1",
          channelId: "channel-id",
          content: "直近メッセージ1",
          createdAt: "2026-02-23 08:56:00 JST",
          id: "recent-message-id-1",
          mentionedBot: false,
          replyTo: {
            authorId: "reply-author-id-1",
            authorIsBot: false,
            authorName: "reply-author-name-1",
            content: "返信先本文1",
            createdAt: "2026-02-23 08:55:00 JST",
            id: "reply-message-id-1",
          },
        },
        {
          authorId: "recent-author-id-2",
          authorIsBot: false,
          authorName: "recent-author-name-2",
          channelId: "channel-id",
          content: "直近メッセージ2",
          createdAt: "2026-02-23 08:58:00 JST",
          id: "recent-message-id-2",
          mentionedBot: false,
          replyTo: {
            authorId: "reply-author-id-2",
            authorIsBot: true,
            authorName: "reply-author-name-2",
            content: "返信先本文2",
            createdAt: "2026-02-23 08:57:00 JST",
            id: "reply-message-id-2",
          },
        },
      ];
      input.currentMessage.replyTo = {
        authorId: "reply-author-id-current",
        authorIsBot: false,
        authorName: "reply-author-name-current",
        content: "返信先本文-current",
        createdAt: "2026-02-23 08:59:00 JST",
        id: "reply-message-id-current",
      };
      input.currentMessage.content = "投稿本文1\n投稿本文2\n投稿本文3";
      const promptBundle = await buildPromptBundle(input, workspaceDir);

      const quotedReplyMetaCount = (promptBundle.userRolePrompt.match(/^> \[/gm) ?? []).length;
      expect(quotedReplyMetaCount).toBe(3);
      expect(promptBundle.userRolePrompt).not.toContain("返信先メッセージ:");
      expect(promptBundle.userRolePrompt).toContain("投稿本文3");
      expect(promptBundle.userRolePrompt).toMatchSnapshot();
    });
  });

  it("リアクションがある場合は絵文字別に表示し、自分の分だけ自分済みを付ける", async () => {
    await withWorkspaceDir(async (workspaceDir) => {
      const input = createInput();
      input.currentMessage.reactions = [
        {
          count: 3,
          emoji: "👍",
          selfReacted: true,
        },
        {
          count: 1,
          emoji: "🎉",
        },
      ];
      input.currentMessage.replyTo = {
        authorId: "reply-author-id",
        authorIsBot: false,
        authorName: "reply-author-name",
        content: "返信先本文",
        createdAt: "2026-02-23 08:58:00 JST",
        id: "reply-message-id",
        reactions: [
          {
            count: 2,
            emoji: "🔥",
            selfReacted: true,
          },
        ],
      };
      const promptBundle = await buildPromptBundle(input, workspaceDir);

      expect(promptBundle.userRolePrompt).toContain("リアクション: 👍 x3 (自分済み), 🎉 x1");
      expect(promptBundle.userRolePrompt).toContain("> リアクション: 🔥 x2 (自分済み)");
      expect(promptBundle.userRolePrompt).toMatchSnapshot();
    });
  });

  it("リアクションがない場合はリアクション行を出力しない", async () => {
    await withWorkspaceDir(async (workspaceDir) => {
      const promptBundle = await buildPromptBundle(createInput(), workspaceDir);

      expect(promptBundle.userRolePrompt).not.toContain("リアクション:");
    });
  });

  it("直近メッセージが0件の場合は直近メッセージセクションを出力しない", async () => {
    await withWorkspaceDir(async (workspaceDir) => {
      const input = createInput();
      input.recentMessages = [];

      const promptBundle = await buildPromptBundle(input, workspaceDir);

      expect(promptBundle.userRolePrompt).not.toContain("## 直近のメッセージ");
      expect(promptBundle.userRolePrompt).not.toContain("(none)");
      expect(promptBundle.userRolePrompt).toContain("## 投稿されたメッセージ");
      expect(promptBundle.userRolePrompt).toMatchSnapshot();
    });
  });

  it("DMの場合はユーザー名ヘッダーを出力する", async () => {
    await withWorkspaceDir(async (workspaceDir) => {
      const input = createDmInput();
      const promptBundle = await buildPromptBundle(input, workspaceDir);

      expect(promptBundle.userRolePrompt).toContain("新しいダイレクトメッセージです。");
      expect(promptBundle.userRolePrompt).toContain("ユーザー名: author-name (ID: author-id)");
      expect(promptBundle.userRolePrompt).not.toContain("チャンネル名:");
      expect(promptBundle.userRolePrompt).toMatchSnapshot();
    });
  });

  it("RUNBOOK 由来の文字列を含めない", async () => {
    await withWorkspaceDir(async (workspaceDir) => {
      const promptBundle = await buildPromptBundle(createInput(), workspaceDir);
      const merged = [
        promptBundle.instructions,
        promptBundle.developerRolePrompt,
        promptBundle.userRolePrompt,
      ].join("\n");

      expect(merged).not.toContain("RUNBOOK.md");
      expect(merged).not.toContain("operation rules:");
    });
  });

  it("workspace の LUNA.md と SOUL.md を固定 instructions の直後に結合する", async () => {
    await withWorkspaceDir(async (workspaceDir) => {
      await writeFile(resolve(workspaceDir, "LUNA.md"), "LUNA の追加指示");
      await writeFile(resolve(workspaceDir, "SOUL.md"), "SOUL の追加指示");

      const promptBundle = await buildPromptBundle(createInput(), workspaceDir);
      const baseIndex = promptBundle.instructions.indexOf(
        "セーフティガードを決して回避してはいけません。",
      );
      const lunaIndex = promptBundle.instructions.indexOf("LUNA の追加指示");
      const soulIndex = promptBundle.instructions.indexOf("SOUL の追加指示");

      expect(baseIndex).toBeGreaterThanOrEqual(0);
      expect(lunaIndex).toBeGreaterThan(baseIndex);
      expect(soulIndex).toBeGreaterThan(lunaIndex);
      expect(promptBundle.instructions).toMatchSnapshot();
    });
  });

  it("片方のファイルだけ存在する場合は存在する内容のみ連結する", async () => {
    await withWorkspaceDir(async (workspaceDir) => {
      await writeFile(resolve(workspaceDir, "SOUL.md"), "SOUL の追加指示");

      const promptBundle = await buildPromptBundle(createInput(), workspaceDir);

      expect(promptBundle.instructions).toContain("SOUL の追加指示");
      expect(promptBundle.instructions).not.toContain("LUNA の追加指示");
      expect(promptBundle.instructions).toMatchSnapshot();
    });
  });

  it("ファイルが存在しても読み込み失敗する場合は無視して継続する", async () => {
    await withWorkspaceDir(async (workspaceDir) => {
      await mkdir(resolve(workspaceDir, "LUNA.md"));
      await writeFile(resolve(workspaceDir, "SOUL.md"), "SOUL の追加指示");

      const promptBundle = await buildPromptBundle(createInput(), workspaceDir);

      expect(promptBundle.instructions).toContain(
        "あなたはLunaで動作しているパーソナルアシスタント",
      );
      expect(promptBundle.instructions).toContain("SOUL の追加指示");
      expect(promptBundle.instructions).toMatchSnapshot();
    });
  });
});

describe("buildHeartbeatPromptBundle", () => {
  it("heartbeat 用の user role prompt を固定文言で生成する", async () => {
    await withWorkspaceDir(async (workspaceDir) => {
      const promptBundle = await buildHeartbeatPromptBundle(
        workspaceDir,
        "HEARTBEAT.mdを確認し、作業を行ってください。",
      );

      expect(promptBundle).toMatchSnapshot();
      expect(promptBundle.userRolePrompt).toBe("HEARTBEAT.mdを確認し、作業を行ってください。");
      expect(promptBundle.userRolePrompt).not.toContain("チャンネル名:");
    });
  });
});

describe("buildSteerPrompt", () => {
  it("追加メッセージ見出し付きでメッセージ本文を生成する", () => {
    const input = createInput();
    const steerPrompt = buildSteerPrompt({
      context: input.context,
      message: input.currentMessage,
    });

    expect(steerPrompt).toMatch(
      /^新しいチャンネルメッセージです。\nチャンネル名: channel-name \(ID: channel-id\)\n\n## 投稿されたメッセージ\n\n\[2026-02-23 09:00:00 JST\] author-name \(ID: author-id\) \(Message ID: message-id\):\nテスト本文$/,
    );
    expect(steerPrompt).toMatchSnapshot();
  });

  it("返信先がある場合は引用形式を含める", () => {
    const input = createInput();
    const message = input.currentMessage;
    message.replyTo = {
      authorId: "reply-author-id",
      authorIsBot: false,
      authorName: "reply-author-name",
      content: "返信先本文",
      createdAt: "2026-02-23 08:58:00 JST",
      id: "reply-message-id",
    };

    const steerPrompt = buildSteerPrompt({
      context: input.context,
      message,
    });

    expect(steerPrompt).toContain("## 投稿されたメッセージ");
    expect(steerPrompt).toContain(
      "> [2026-02-23 08:58:00 JST] reply-author-name (ID: reply-author-id) (Message ID: reply-message-id):",
    );
    expect(steerPrompt).toContain("> 返信先本文");
    expect(steerPrompt).toMatch(/> 返信先本文\n\[2026-02-23 09:00:00 JST]/);
    expect(steerPrompt).toMatchSnapshot();
  });

  it("リアクションがある場合は steer prompt にも表示する", () => {
    const input = createInput();
    const message = input.currentMessage;
    message.reactions = [
      {
        count: 3,
        emoji: "👍",
        selfReacted: true,
      },
      {
        count: 1,
        emoji: "🎉",
      },
    ];

    const steerPrompt = buildSteerPrompt({
      context: input.context,
      message,
    });

    expect(steerPrompt).toContain("リアクション: 👍 x3 (自分済み), 🎉 x1");
    expect(steerPrompt).toMatchSnapshot();
  });

  it("未注入チャンネルの場合は初期履歴セクションを追加する", () => {
    const input = createInput();
    const steerPrompt = buildSteerPrompt({
      context: input.context,
      message: input.currentMessage,
      recentMessages: input.recentMessages,
    });

    expect(steerPrompt).toContain("## このチャンネルの初期履歴");
    expect(steerPrompt).toContain("recent-message-id");
    expect(steerPrompt).toMatchSnapshot();
  });

  it("DMの場合はユーザー名ヘッダーとDM履歴見出しを出力する", () => {
    const input = createDmInput();
    const steerPrompt = buildSteerPrompt({
      context: input.context,
      message: input.currentMessage,
      recentMessages: input.recentMessages,
    });

    expect(steerPrompt).toContain("新しいダイレクトメッセージです。");
    expect(steerPrompt).toContain("ユーザー名: author-name (ID: author-id)");
    expect(steerPrompt).toContain("## このDMの初期履歴");
    expect(steerPrompt).not.toContain("チャンネル名:");
    expect(steerPrompt).toMatchSnapshot();
  });
});

function createInput(): {
  context: DiscordPromptContext;
  currentMessage: RuntimeMessage;
  recentMessages: RuntimeMessage[];
} {
  return {
    context: {
      kind: "channel",
      channelName: "channel-name",
    },
    currentMessage: {
      authorId: "author-id",
      authorIsBot: false,
      authorName: "author-name",
      channelId: "channel-id",
      content: "テスト本文",
      createdAt: "2026-02-23 09:00:00 JST",
      id: "message-id",
      mentionedBot: false,
    },
    recentMessages: [
      {
        authorId: "recent-author-id",
        authorIsBot: true,
        authorName: "recent-author-name",
        channelId: "channel-id",
        content: "直近メッセージ",
        createdAt: "2026-02-23 08:59:00 JST",
        id: "recent-message-id",
        mentionedBot: false,
      },
    ],
  };
}

function createDmInput(): {
  context: DiscordPromptContext;
  currentMessage: RuntimeMessage;
  recentMessages: RuntimeMessage[];
} {
  return {
    context: {
      kind: "dm",
    },
    currentMessage: {
      authorId: "author-id",
      authorIsBot: false,
      authorName: "author-name",
      channelId: "channel-id",
      content: "テスト本文",
      createdAt: "2026-02-23 09:00:00 JST",
      id: "message-id",
      mentionedBot: false,
    },
    recentMessages: [
      {
        authorId: "recent-author-id",
        authorIsBot: true,
        authorName: "recent-author-name",
        channelId: "channel-id",
        content: "直近メッセージ",
        createdAt: "2026-02-23 08:59:00 JST",
        id: "recent-message-id",
        mentionedBot: false,
      },
    ],
  };
}

async function withWorkspaceDir(run: (workspaceDir: string) => Promise<void>): Promise<void> {
  const workspaceDir = await mkdtemp(join(tmpdir(), "luna-prompt-composer-"));
  try {
    await run(workspaceDir);
  } finally {
    await rm(workspaceDir, {
      force: true,
      recursive: true,
    });
  }
}
