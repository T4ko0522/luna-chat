import {
  type ChatInputCommandInteraction,
  SlashCommandBuilder,
} from "discord.js";

import { updateBlacklistInConfigToml } from "../runtime-config/runtime-config";

type LoggerLike = {
  info: (...arguments_: unknown[]) => void;
  warn: (...arguments_: unknown[]) => void;
};

export function buildBlacklistCommand() {
  return new SlashCommandBuilder()
    .setName("blacklist")
    .setDescription("ブラックリストを管理する")
    .addSubcommand((sub) =>
      sub
        .setName("add")
        .setDescription("ユーザーをブラックリストに追加する")
        .addUserOption((option) =>
          option.setName("user").setDescription("対象ユーザー").setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("remove")
        .setDescription("ユーザーをブラックリストから削除する")
        .addUserOption((option) =>
          option.setName("user").setDescription("対象ユーザー").setRequired(true),
        ),
    );
}

export type HandleBlacklistCommandInput = {
  interaction: ChatInputCommandInteraction;
  adminUserIds: ReadonlySet<string>;
  blacklistedUserIds: Set<string>;
  configFilePath: string;
  logger: LoggerLike;
};

export async function handleBlacklistCommand(
  input: HandleBlacklistCommandInput,
): Promise<void> {
  const { interaction, adminUserIds, blacklistedUserIds, configFilePath } = input;

  if (!adminUserIds.has(interaction.user.id)) {
    await interaction.reply({
      content: "この操作は管理者のみ実行できます。",
      ephemeral: true,
    });
    return;
  }

  const subcommand = interaction.options.getSubcommand();
  const targetUser = interaction.options.getUser("user", true);

  if (subcommand === "add") {
    blacklistedUserIds.add(targetUser.id);
    await updateBlacklistInConfigToml(configFilePath, Array.from(blacklistedUserIds));
    await interaction.reply({
      content: `${targetUser.username} をブラックリストに追加しました。`,
      ephemeral: true,
    });
    input.logger.info("Blacklist updated: added user.", { userId: targetUser.id });
    return;
  }

  if (subcommand === "remove") {
    blacklistedUserIds.delete(targetUser.id);
    await updateBlacklistInConfigToml(configFilePath, Array.from(blacklistedUserIds));
    await interaction.reply({
      content: `${targetUser.username} をブラックリストから削除しました。`,
      ephemeral: true,
    });
    input.logger.info("Blacklist updated: removed user.", { userId: targetUser.id });
    return;
  }
}
