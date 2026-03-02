import type { RuntimeReaction } from "./runtime-reaction";

type PlainTextMessageBlockInput = {
  authorLabel: string;
  content: string;
  createdAt: string;
  id: string;
  reactions?: RuntimeReaction[];
};

export function formatPlainTextMessageBlock(input: PlainTextMessageBlockInput): string {
  const lines = [
    `[${input.createdAt}] ${input.authorLabel} (Message ID: ${input.id}):`,
    input.content,
  ];
  if (input.reactions && input.reactions.length > 0) {
    lines.push(`リアクション: ${formatRuntimeReactions(input.reactions)}`);
  }

  return lines.join("\n");
}

export function formatPlainTextMessageWithReply(input: {
  message: PlainTextMessageBlockInput;
  replyTo?: PlainTextMessageBlockInput;
}): string {
  const messageBlock = formatPlainTextMessageBlock(input.message);
  if (!input.replyTo) {
    return messageBlock;
  }

  return [toQuotedBlock(formatPlainTextMessageBlock(input.replyTo)), messageBlock].join("\n");
}

function toQuotedBlock(block: string): string {
  return block
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

function formatRuntimeReactions(reactions: readonly RuntimeReaction[]): string {
  return reactions
    .map((reaction) => {
      return `${reaction.emoji} x${reaction.count}${reaction.selfReacted ? " (自分済み)" : ""}`;
    })
    .join(", ");
}
