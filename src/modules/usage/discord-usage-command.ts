import { type ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";

import type { GetAccountRateLimitsResponse } from "../ai/codex-generated/v2/GetAccountRateLimitsResponse";
import type { RateLimitSnapshot } from "../ai/codex-generated/v2/RateLimitSnapshot";
import type { RateLimitWindow } from "../ai/codex-generated/v2/RateLimitWindow";

export function buildUsageCommand() {
  return new SlashCommandBuilder()
    .setName("usage")
    .setDescription("Codexの現在の使用状況を表示する");
}

export type HandleUsageCommandInput = {
  interaction: ChatInputCommandInteraction;
  getRateLimits: () => Promise<GetAccountRateLimitsResponse>;
};

export async function handleUsageCommand(input: HandleUsageCommandInput): Promise<void> {
  const { interaction, getRateLimits } = input;

  await interaction.deferReply();

  const response = await getRateLimits();
  const lines = formatRateLimitsResponse(response);

  await interaction.editReply({
    content: lines.join("\n"),
  });
}

function formatRateLimitsResponse(response: GetAccountRateLimitsResponse): string[] {
  const lines: string[] = ["## Codex 使用状況", ""];

  if (response.rateLimitsByLimitId) {
    for (const [limitId, snapshot] of Object.entries(response.rateLimitsByLimitId)) {
      if (!snapshot) continue;
      lines.push(`### ${snapshot.limitName ?? limitId}`);
      lines.push(...formatSnapshot(snapshot));
      lines.push("");
    }
  } else {
    lines.push(...formatSnapshot(response.rateLimits));
  }

  return lines;
}

function formatSnapshot(snapshot: RateLimitSnapshot): string[] {
  const lines: string[] = [];

  if (snapshot.planType) {
    lines.push(`**プラン**: ${snapshot.planType}`);
  }

  if (snapshot.credits) {
    if (snapshot.credits.unlimited) {
      lines.push("**クレジット**: 無制限");
    } else if (snapshot.credits.balance !== null) {
      lines.push(`**クレジット残高**: $${snapshot.credits.balance}`);
    }
  }

  if (snapshot.primary) {
    lines.push(`**プライマリ**: ${formatWindow(snapshot.primary)}`);
  }

  if (snapshot.secondary) {
    lines.push(`**セカンダリ**: ${formatWindow(snapshot.secondary)}`);
  }

  return lines;
}

function formatWindow(window: RateLimitWindow): string {
  const percent = `${window.usedPercent.toFixed(1)}% 使用`;

  const parts = [percent];

  if (window.resetsAt !== null) {
    const resetsAtDate = new Date(window.resetsAt * 1000);
    const resetsIn = formatDuration(resetsAtDate.getTime() - Date.now());
    parts.push(`リセットまで ${resetsIn}`);
  }

  if (window.windowDurationMins !== null) {
    parts.push(`${window.windowDurationMins}分間`);
  }

  return parts.join(" / ");
}

function formatDuration(ms: number): string {
  if (ms <= 0) return "まもなく";

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}時間`);
  if (minutes % 60 > 0) parts.push(`${minutes % 60}分`);
  if (parts.length === 0) parts.push(`${seconds}秒`);

  return parts.join("");
}
