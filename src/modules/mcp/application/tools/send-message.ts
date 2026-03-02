import type {
  DiscordCommandGateway,
  DiscordCommandTarget,
} from "../../ports/outbound/discord-command-gateway-port";

export async function sendMessageTool(input: {
  gateway: DiscordCommandGateway;
  replyToMessageId?: string;
  target: DiscordCommandTarget;
  text: string;
}): Promise<{ ok: true }> {
  const channelId = await input.gateway.resolveChannelId(input.target);
  return await input.gateway.sendMessage({
    channelId,
    text: input.text,
    ...(input.replyToMessageId === undefined ? {} : { replyToMessageId: input.replyToMessageId }),
  });
}
