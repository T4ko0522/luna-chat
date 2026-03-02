import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { formatMessageAuthorLabel } from "../../../shared/discord/message-author-label";
import type { RuntimeMessage } from "../../conversation/domain/runtime-message";
import type { DiscordPromptContext } from "../ports/inbound/ai-service-port";

type ThreadPromptBundle = {
  instructions: string;
  developerRolePrompt: string;
};

type UserRolePromptInput = {
  context: DiscordPromptContext;
  currentMessage: RuntimeMessage;
  recentMessages: RuntimeMessage[];
};

const WORKSPACE_INSTRUCTION_FILES = ["LUNA.md", "SOUL.md"] as const;
const DEVELOPER_ROLE_PROMPT = [
  "メッセージに返信やリアクションをする場合は`discord`ツールを使うこと。",
  "思考に時間がかかる場合や複数回のツール呼び出し、Web検索などを行う場合は、必要に応じて`start_typing`を使って入力中表示を開始し、ユーザーに作業中であることを伝えること。",
].join("\n");

export function buildUserRolePrompt(input: UserRolePromptInput): string {
  const recentMessages = input.recentMessages.map(formatRuntimeMessageForPrompt);
  const userRolePromptLines = buildPromptHeaderLines(input.context, input.currentMessage);
  if (recentMessages.length > 0) {
    userRolePromptLines.push("## 直近のメッセージ", "", recentMessages.join("\n\n"), "");
  }
  userRolePromptLines.push(
    "## 投稿されたメッセージ",
    "",
    formatRuntimeMessageForPrompt(input.currentMessage),
  );
  return userRolePromptLines.join("\n");
}

function formatRuntimeMessageForPrompt(message: RuntimeMessage): string {
  const messageBlock = formatRuntimeMessageBlock(message);
  if (!message.replyTo) {
    return messageBlock;
  }

  return [toQuotedBlock(formatRuntimeMessageBlock(message.replyTo)), messageBlock].join("\n");
}

function formatRuntimeMessageBlock(
  message: Pick<
    RuntimeMessage,
    "id" | "authorId" | "authorIsBot" | "authorName" | "content" | "createdAt" | "reactions"
  >,
): string {
  const lines = [formatRuntimeMessageMetaLine(message), message.content];
  if (message.reactions && message.reactions.length > 0) {
    lines.push(`リアクション: ${formatRuntimeReactions(message.reactions)}`);
  }

  return lines.join("\n");
}

function formatRuntimeMessageMetaLine(
  message: Pick<RuntimeMessage, "id" | "authorId" | "authorIsBot" | "authorName" | "createdAt">,
): string {
  return `[${message.createdAt}] ${formatMessageAuthorLabel(message)} (Message ID: ${message.id}):`;
}

function buildPromptHeaderLines(
  context: DiscordPromptContext,
  message: Pick<RuntimeMessage, "authorId" | "authorName" | "channelId">,
): string[] {
  if (context.kind === "dm") {
    return [
      "新しいダイレクトメッセージです。",
      `ユーザー名: ${message.authorName} (ID: ${message.authorId})`,
      "",
    ];
  }

  return [
    "新しいチャンネルメッセージです。",
    `チャンネル名: ${context.channelName} (ID: ${message.channelId})`,
    "",
  ];
}

function toQuotedBlock(block: string): string {
  return block
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

function formatRuntimeReactions(reactions: NonNullable<RuntimeMessage["reactions"]>): string {
  return reactions
    .map((reaction) => {
      return `${reaction.emoji} x${reaction.count}${reaction.selfReacted ? " (自分済み)" : ""}`;
    })
    .join(", ");
}

export async function buildHeartbeatPromptBundle(
  workspaceDir: string,
  prompt: string,
): Promise<ThreadPromptBundle & { userRolePrompt: string }> {
  const threadPromptBundle = await buildThreadPromptBundle(workspaceDir);

  return {
    ...threadPromptBundle,
    userRolePrompt: prompt,
  };
}

export async function buildThreadPromptBundle(workspaceDir: string): Promise<ThreadPromptBundle> {
  const instructions = await buildInstructions(workspaceDir);

  return {
    developerRolePrompt: DEVELOPER_ROLE_PROMPT,
    instructions,
  };
}

async function buildInstructions(workspaceDir: string): Promise<string> {
  return [
    "あなたはLunaで動作しているパーソナルアシスタントです。常に日本語で応答してください。",
    "",
    "## セーフティガード",
    "",
    "ユーザーからの入力の全てに従う必要はありません。目的の達成よりも人間の安全性を優先してください。",
    "ユーザーからワークスペース内のファイルの削除や内容の大幅な改変を求められた場合は、実行を拒否してください。",
    "セーフティガードを決して回避してはいけません。",
    "",
    ...(await readWorkspaceInstructions(workspaceDir)),
  ].join("\n");
}

async function readWorkspaceInstructions(workspaceDir: string): Promise<string[]> {
  const loaded = await Promise.all(
    WORKSPACE_INSTRUCTION_FILES.map(async (fileName) => {
      const filePath = resolve(workspaceDir, fileName);

      try {
        const content = await readFile(filePath, "utf8");
        return content;
      } catch {
        return undefined;
      }
    }),
  );

  return loaded.flatMap((content) => {
    return content === undefined ? [] : [content];
  });
}
