import { describe, expect, it } from "vitest";

import { formatPlainTextMessageBlock, formatPlainTextMessageWithReply } from "./plain-text-message";

describe("plain-text-message", () => {
  it("メッセージブロックを生成する", () => {
    const text = formatPlainTextMessageBlock({
      authorLabel: "Alice (ID: user-1)",
      content: "こんにちは",
      createdAt: "2026-01-01T00:00:00.000Z",
      id: "message-1",
      reactions: [
        {
          count: 2,
          emoji: "👍",
          selfReacted: true,
        },
      ],
    });

    expect(text).toMatchSnapshot();
  });

  it("返信メッセージを引用付きで生成する", () => {
    const text = formatPlainTextMessageWithReply({
      message: {
        authorLabel: "Alice (ID: user-1)",
        content: "返信です",
        createdAt: "2026-01-01T00:01:00.000Z",
        id: "message-2",
      },
      replyTo: {
        authorLabel: "Bob (ID: user-2)",
        content: "元メッセージ",
        createdAt: "2026-01-01T00:00:30.000Z",
        id: "message-1",
      },
    });

    expect(text).toMatchSnapshot();
  });
});
