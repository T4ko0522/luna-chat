import type {
  DiscordCommandGateway,
  DiscordCommandTarget,
} from "../../ports/outbound/discord-command-gateway-port";

export async function addReactionTool(input: {
  emoji: string;
  gateway: DiscordCommandGateway;
  messageId: string;
  target: DiscordCommandTarget;
}): Promise<{ ok: true }> {
  const channelId = await input.gateway.resolveChannelId(input.target);
  return await input.gateway.addReaction({
    channelId,
    emoji: input.emoji,
    messageId: input.messageId,
  });
}
