import type { RuntimeMessage } from "../../../conversation/domain/runtime-message";

export type AiInput = {
  channelName: string;
  currentMessage: RuntimeMessage;
  loadRecentMessages: () => Promise<RuntimeMessage[]>;
};

export type HeartbeatInput = {
  prompt: string;
  source?: "heartbeat" | "cron";
};

export interface AiService {
  generateReply(input: AiInput): Promise<void>;
  generateHeartbeat(input: HeartbeatInput): Promise<void>;
}
