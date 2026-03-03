import { describe, expect, it } from "vitest";

import {
  formatAddReactionContent,
  formatGetRepoDailyChangesContent,
  formatGetUserDetailContent,
  formatListChannelsContent,
  formatReadMessageHistoryContent,
  formatReadRepoContentContent,
  formatSendMessageContent,
  formatStartTypingContent,
} from "./discord-mcp-response-text";

describe("discord-mcp-response-text", () => {
  it("read_message_history のレスポンスを整形する", () => {
    const text = formatReadMessageHistoryContent({
      channelId: "channel-1",
      messages: [
        {
          authorName: "Alice (ID: user-1)",
          content: "old",
          createdAt: "2026-01-01 09:00:00 JST",
          id: "message-1",
        },
        {
          authorName: "Bob (ID: user-2)",
          content: "new",
          createdAt: "2026-01-01 09:01:00 JST",
          id: "message-2",
          reactions: [
            {
              count: 1,
              emoji: "👍",
              selfReacted: true,
            },
          ],
        },
      ],
    });

    expect(text).toMatchSnapshot();
  });

  it("他ツールのレスポンスを整形する", () => {
    expect(
      formatSendMessageContent({
        channelId: "channel-1",
        replyToMessageId: "reply-1",
      }),
    ).toMatchSnapshot("send_message");

    expect(
      formatAddReactionContent({
        emoji: "👍",
        messageId: "message-1",
        userId: "user-1",
      }),
    ).toMatchSnapshot("add_reaction");

    expect(
      formatStartTypingContent({
        alreadyRunning: false,
        channelId: "channel-1",
      }),
    ).toMatchSnapshot("start_typing");

    expect(
      formatListChannelsContent({
        channels: [
          {
            guildId: "guild-1",
            guildName: "Guild Name",
            id: "channel-1",
            name: "general",
          },
        ],
      }),
    ).toMatchSnapshot("list_channels");

    expect(
      formatGetRepoDailyChangesContent({
        repoUrl: "https://github.com/owner/repo",
        action: "pulled",
        since: "2026-03-04",
        commits: [
          {
            hash: "abc1234567890",
            authorName: "Alice",
            date: "2026-03-04T10:00:00+09:00",
            subject: "feat: add feature",
          },
          {
            hash: "def5678901234",
            authorName: "Bob",
            date: "2026-03-04T09:30:00+09:00",
            subject: "fix: bug fix",
          },
        ],
      }),
    ).toMatchSnapshot("get_repo_daily_changes");

    expect(
      formatGetRepoDailyChangesContent({
        repoUrl: "https://github.com/owner/repo",
        action: "cloned",
        since: "2026-03-04",
        commits: [],
      }),
    ).toMatchSnapshot("get_repo_daily_changes_empty");

    expect(
      formatReadRepoContentContent({
        repoUrl: "https://github.com/owner/repo",
        action: "pulled",
        path: "src/",
        files: [
          { path: "src/index.ts", content: "console.log('hello');" },
          { path: "src/utils.ts", content: "export const add = (a, b) => a + b;" },
        ],
        skippedFiles: ["src/large.bin"],
        totalTrackedFiles: 10,
      }),
    ).toMatchSnapshot("read_repo_content");

    expect(
      formatReadRepoContentContent({
        repoUrl: "https://github.com/owner/repo",
        action: "cloned",
        path: undefined,
        files: [],
        skippedFiles: [],
        totalTrackedFiles: 0,
      }),
    ).toMatchSnapshot("read_repo_content_empty");

    expect(
      formatGetUserDetailContent({
        user: {
          avatar: null,
          banner: null,
          bot: false,
          displayName: "Alice",
          globalName: "Alice Global",
          id: "user-1",
          nickname: null,
          username: "alice",
        },
      }),
    ).toMatchSnapshot("get_user_detail");
  });

});
