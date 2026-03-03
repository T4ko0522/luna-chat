import { formatPlainTextMessageBlock } from "../../../shared/discord/plain-text-message";
import type { RuntimeReaction } from "../../../shared/discord/runtime-reaction";
import type { GitCommitEntry } from "../../git/ports/outbound/git-command-gateway-port";

type ReadMessageHistoryResult = {
  channelId: string;
  messages: Array<{
    authorName: string;
    content: string;
    createdAt: string;
    id: string;
    reactions?: RuntimeReaction[];
  }>;
};

type ListChannelsResult = {
  channels: Array<{
    guildId: string | null;
    guildName: string | null;
    id: string;
    name: string;
  }>;
};

type GetUserDetailResult = {
  user: {
    avatar: string | null;
    banner: string | null;
    bot: boolean;
    displayName: string;
    globalName: string | null;
    id: string;
    nickname: string | null;
    username: string;
  } | null;
};

export function formatReadMessageHistoryContent(payload: ReadMessageHistoryResult): string {
  if (payload.messages.length === 0) {
    return "メッセージはありません。";
  }

  const messageBlocks = payload.messages.map((message) => {
    return formatPlainTextMessageBlock({
      authorLabel: message.authorName,
      content: message.content,
      createdAt: message.createdAt,
      id: message.id,
      ...(message.reactions ? { reactions: message.reactions } : {}),
    });
  });

  return messageBlocks.join("\n\n");
}

export function formatSendMessageContent(_input: {
  channelId?: string;
  replyToMessageId?: string;
  userId?: string;
}): string {
  return "OK";
}

export function formatAddReactionContent(_input: {
  channelId?: string;
  emoji: string;
  messageId: string;
  userId?: string;
}): string {
  return "OK";
}

export function formatStartTypingContent(_input: {
  alreadyRunning: boolean;
  channelId?: string;
  userId?: string;
}): string {
  return "OK";
}

export function formatListChannelsContent(payload: ListChannelsResult): string {
  if (payload.channels.length === 0) {
    return "チャンネルはありません。";
  }

  const lines = payload.channels.map((channel) => {
    const guildLabel =
      channel.guildId === null
        ? "Guild: なし"
        : `Guild: ${channel.guildName ?? "不明"} (ID: ${channel.guildId})`;
    return `- ${channel.name} (ID: ${channel.id}, ${guildLabel})`;
  });

  return lines.join("\n");
}

type GetRepoDailyChangesResult = {
  repoUrl: string;
  action: "cloned" | "pulled";
  since: string;
  commits: GitCommitEntry[];
};

export function formatGetRepoDailyChangesContent(
  payload: GetRepoDailyChangesResult,
): string {
  const header = [
    `リポジトリ: ${payload.repoUrl}`,
    `取得方法: ${payload.action}`,
    `対象日: ${payload.since} 以降`,
  ].join("\n");

  if (payload.commits.length === 0) {
    return `${header}\n\n対象期間のコミットはありません。`;
  }

  const commitLines = payload.commits.map((commit) => {
    return `- ${commit.hash.slice(0, 7)} ${commit.subject} (${commit.authorName}, ${commit.date})`;
  });

  return `${header}\n\nコミット (${payload.commits.length}件):\n${commitLines.join("\n")}`;
}

type ReadRepoContentResult = {
  repoUrl: string;
  action: "cloned" | "pulled";
  path: string | undefined;
  files: Array<{ path: string; content: string }>;
  skippedFiles: string[];
  totalTrackedFiles: number;
};

export function formatReadRepoContentContent(payload: ReadRepoContentResult): string {
  const header = [
    `リポジトリ: ${payload.repoUrl}`,
    `取得方法: ${payload.action}`,
    `対象パス: ${payload.path ?? "(全体)"}`,
    `ファイル数: ${payload.files.length} / ${payload.totalTrackedFiles}（トラッキング対象）`,
  ].join("\n");

  if (payload.files.length === 0) {
    const result = `${header}\n\n対象ファイルはありません。`;
    if (payload.skippedFiles.length > 0) {
      return `${result}\n\nスキップされたファイル (${payload.skippedFiles.length}件):\n${payload.skippedFiles.map((f) => `- ${f}`).join("\n")}`;
    }
    return result;
  }

  const fileBlocks = payload.files.map((file) => {
    return `--- ${file.path} ---\n${file.content}`;
  });

  let result = `${header}\n\n${fileBlocks.join("\n\n")}`;

  if (payload.skippedFiles.length > 0) {
    result += `\n\nスキップされたファイル (${payload.skippedFiles.length}件):\n${payload.skippedFiles.map((f) => `- ${f}`).join("\n")}`;
  }

  return result;
}

export function formatGetUserDetailContent(payload: GetUserDetailResult): string {
  if (!payload.user) {
    return "ユーザー情報を取得できませんでした。";
  }

  return [
    `表示名: ${payload.user.displayName}`,
    `ユーザー名: ${payload.user.username}`,
    `ユーザーID: ${payload.user.id}`,
    `Bot: ${payload.user.bot ? "true" : "false"}`,
    `ニックネーム: ${payload.user.nickname ?? "なし"}`,
    `グローバル名: ${payload.user.globalName ?? "なし"}`,
    `アバター: ${payload.user.avatar ?? "なし"}`,
    `バナー: ${payload.user.banner ?? "なし"}`,
  ].join("\n");
}
