import { logger } from "../../../shared/logger";
import type { ReasoningEffort } from "../codex-generated/ReasoningEffort";
import type { TurnResult } from "../domain/turn-result";
import type { AiInput, AiService, HeartbeatInput } from "../ports/inbound/ai-service-port";
import type { AiRuntimePort, StartedTurn, TurnObserver } from "../ports/outbound/ai-runtime-port";

import { buildHeartbeatPromptBundle, buildPromptBundle, buildSteerPrompt } from "./prompt-composer";
import { buildThreadConfig } from "./thread-config-factory";

type TimeoutHandle = ReturnType<typeof setTimeout>;

type ChannelSessionCoordinatorOptions = {
  createRuntime: () => AiRuntimePort;
  discordMcpServerUrl: string;
  onDiscordTurnCompleted?: (channelId: string) => void | Promise<void>;
  reasoningEffort: ReasoningEffort;
  workspaceDir: string;
  discordTurnTimeoutMs: number;
  heartbeatTurnTimeoutMs: number;
  sessionIdleMs?: number;
  now?: () => number;
  setTimeoutFn?: (handler: () => void, timeoutMs: number) => TimeoutHandle;
  clearTimeoutFn?: (handle: TimeoutHandle) => void;
};

type TurnLogContext =
  | {
      source: "discord";
      channelId: string;
      messageId: string;
    }
  | {
      source: "heartbeat";
    }
  | {
      source: "cron";
    };

type DiscordSession = {
  threadId: string;
  opChain: Promise<void>;
  injectedChannelIds: Set<string>;
  activeTurnId: string | undefined;
  activeTurnChannelIds: Set<string>;
  turnCompletion: Promise<void> | undefined;
  closeAfterTurn: boolean;
  lastMessageAt: number;
  idleTimer: TimeoutHandle | undefined;
};

const DEFAULT_SESSION_IDLE_MS = 60 * 60_000;

class TurnFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TurnFailedError";
  }
}

export class ChannelSessionCoordinator implements AiService {
  private readonly sessionIdleMs: number;
  private readonly now: () => number;
  private readonly setTimeoutFn: (handler: () => void, timeoutMs: number) => TimeoutHandle;
  private readonly clearTimeoutFn: (handle: TimeoutHandle) => void;

  private runtime: AiRuntimePort | undefined;
  private runtimeInitialization: Promise<AiRuntimePort> | undefined;
  private runtimeInitialized = false;
  private discordSession: DiscordSession | undefined;

  constructor(private readonly options: ChannelSessionCoordinatorOptions) {
    this.sessionIdleMs = options.sessionIdleMs ?? DEFAULT_SESSION_IDLE_MS;
    this.now = options.now ?? (() => Date.now());
    this.setTimeoutFn = options.setTimeoutFn ?? setTimeout;
    this.clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;
  }

  async initializeRuntime(): Promise<void> {
    await this.ensureRuntime();
  }

  async close(): Promise<void> {
    await this.disposeDiscordSession();
    await this.resetRuntime();
  }

  async generateReply(input: AiInput): Promise<void> {
    try {
      const session = await this.ensureDiscordSession();
      this.touchDiscordSession(session);

      const result = await this.enqueueSessionOperation(session, async () => {
        return await this.handleDiscordMessage(session, input);
      });

      if (result.awaitCompletion) {
        await result.awaitCompletion;
      }
    } catch (error: unknown) {
      if (!(error instanceof TurnFailedError)) {
        await this.resetRuntimeAndSession();
      }
      throw error;
    }
  }

  async generateHeartbeat(input: HeartbeatInput): Promise<void> {
    const context: TurnLogContext = {
      source: input.source ?? "heartbeat",
    };

    try {
      const runtime = await this.ensureRuntime();
      const promptBundle = await buildHeartbeatPromptBundle(
        this.options.workspaceDir,
        input.prompt,
      );
      const threadId = await runtime.startThread({
        config: buildThreadConfig(this.options.reasoningEffort, this.options.discordMcpServerUrl),
        developerRolePrompt: promptBundle.developerRolePrompt,
        instructions: promptBundle.instructions,
      });

      const startedTurn = await runtime.startTurn(
        threadId,
        promptBundle.userRolePrompt,
        createTurnObserver(context),
        {
          timeoutMs: this.options.heartbeatTurnTimeoutMs,
        },
      );
      logTurnStarted(context, threadId, startedTurn.turnId);

      const turnResult = await startedTurn.completion;
      logTurnResult(context, threadId, startedTurn.turnId, turnResult);
      throwIfTurnFailed(turnResult);
    } catch (error: unknown) {
      if (!(error instanceof TurnFailedError)) {
        await this.resetRuntimeAndSession();
      }
      throw error;
    }
  }

  private async handleDiscordMessage(
    session: DiscordSession,
    input: AiInput,
  ): Promise<{
    awaitCompletion?: Promise<void>;
  }> {
    if (this.discordSession !== session) {
      return {};
    }

    const runtime = await this.ensureRuntime();
    const includeRecentMessages = !session.injectedChannelIds.has(input.currentMessage.channelId);
    const recentMessages = includeRecentMessages ? await input.loadRecentMessages() : [];

    if (includeRecentMessages) {
      session.injectedChannelIds.add(input.currentMessage.channelId);
    }

    const threadId = session.threadId;

    if (session.activeTurnId) {
      const expectedTurnId = session.activeTurnId;
      const steerPrompt = buildSteerPrompt({
        context: input.context,
        message: input.currentMessage,
        ...(includeRecentMessages ? { recentMessages } : {}),
      });
      session.activeTurnChannelIds.add(input.currentMessage.channelId);

      try {
        await runtime.steerTurn(threadId, expectedTurnId, steerPrompt);
        return {};
      } catch {
        session.activeTurnChannelIds.delete(input.currentMessage.channelId);
        await runtime.interruptTurn(threadId, expectedTurnId).catch(() => undefined);

        await this.startDiscordTurn(session, runtime, {
          channelId: input.currentMessage.channelId,
          messageId: input.currentMessage.id,
          prompt: steerPrompt,
        });

        return session.turnCompletion ? { awaitCompletion: session.turnCompletion } : {};
      }
    }

    const promptBundle = await buildPromptBundle(
      {
        context: input.context,
        currentMessage: input.currentMessage,
        recentMessages,
      },
      this.options.workspaceDir,
    );

    await this.startDiscordTurn(session, runtime, {
      channelId: input.currentMessage.channelId,
      messageId: input.currentMessage.id,
      prompt: promptBundle.userRolePrompt,
    });

    return session.turnCompletion ? { awaitCompletion: session.turnCompletion } : {};
  }

  private async ensureDiscordSession(): Promise<DiscordSession> {
    const existing = this.discordSession;
    if (existing) {
      return existing;
    }

    const runtime = await this.ensureRuntime();
    const promptBundle = await buildHeartbeatPromptBundle(this.options.workspaceDir, "");
    const threadId = await runtime.startThread({
      config: buildThreadConfig(this.options.reasoningEffort, this.options.discordMcpServerUrl),
      developerRolePrompt: promptBundle.developerRolePrompt,
      instructions: promptBundle.instructions,
    });

    const session: DiscordSession = {
      threadId,
      opChain: Promise.resolve(),
      injectedChannelIds: new Set(),
      activeTurnId: undefined,
      activeTurnChannelIds: new Set(),
      turnCompletion: undefined,
      closeAfterTurn: false,
      lastMessageAt: this.now(),
      idleTimer: undefined,
    };
    this.discordSession = session;
    this.scheduleSessionIdleTimer(session);

    return session;
  }

  private touchDiscordSession(session: DiscordSession): void {
    session.lastMessageAt = this.now();
    session.closeAfterTurn = false;
    this.scheduleSessionIdleTimer(session);
  }

  private scheduleSessionIdleTimer(session: DiscordSession): void {
    if (session.idleTimer) {
      this.clearTimeoutFn(session.idleTimer);
    }

    session.idleTimer = this.setTimeoutFn(() => {
      void this.handleSessionIdleTimeout(session);
    }, this.sessionIdleMs);
  }

  private async handleSessionIdleTimeout(session: DiscordSession): Promise<void> {
    await this.enqueueSessionOperation(session, async () => {
      if (this.discordSession !== session) {
        return;
      }

      if (!this.isSessionIdleExpired(session)) {
        this.scheduleSessionIdleTimer(session);
        return;
      }

      if (session.activeTurnId) {
        session.closeAfterTurn = true;
        return;
      }

      await this.disposeDiscordSession(session);
    });
  }

  private isSessionIdleExpired(session: DiscordSession): boolean {
    return this.now() - session.lastMessageAt >= this.sessionIdleMs;
  }

  private async startDiscordTurn(
    session: DiscordSession,
    runtime: AiRuntimePort,
    input: {
      channelId: string;
      messageId: string;
      prompt: string;
    },
  ): Promise<void> {
    const context: TurnLogContext = {
      source: "discord",
      channelId: input.channelId,
      messageId: input.messageId,
    };

    const startedTurn = await runtime.startTurn(
      session.threadId,
      input.prompt,
      createTurnObserver(context),
      {
        timeoutMs: this.options.discordTurnTimeoutMs,
      },
    );
    session.activeTurnId = startedTurn.turnId;
    session.activeTurnChannelIds = new Set([input.channelId]);

    logTurnStarted(context, session.threadId, startedTurn.turnId);

    const turnCompletion = this.trackDiscordTurnCompletion(session, startedTurn, {
      context,
      threadId: session.threadId,
      turnId: startedTurn.turnId,
    });
    turnCompletion.catch((error: unknown) => {
      logger.warn("Discord turn failed:", error);
    });
    session.turnCompletion = turnCompletion;
  }

  private trackDiscordTurnCompletion(
    session: DiscordSession,
    startedTurn: StartedTurn,
    meta: {
      context: TurnLogContext;
      threadId: string;
      turnId: string;
    },
  ): Promise<void> {
    let shouldDisposeSession = false;

    return startedTurn.completion
      .then((turnResult) => {
        logTurnResult(meta.context, meta.threadId, meta.turnId, turnResult);

        if (turnResult.status !== "completed") {
          shouldDisposeSession = true;
          throwIfTurnFailed(turnResult);
        }
      })
      .finally(() => {
        if (this.discordSession !== session) {
          return;
        }
        if (session.activeTurnId !== meta.turnId) {
          return;
        }

        const completedChannels = Array.from(session.activeTurnChannelIds);
        session.activeTurnId = undefined;
        session.turnCompletion = undefined;
        session.activeTurnChannelIds.clear();

        for (const channelId of completedChannels) {
          this.runOnDiscordTurnCompleted(channelId);
        }

        if (shouldDisposeSession || session.closeAfterTurn || this.isSessionIdleExpired(session)) {
          void this.disposeDiscordSession(session);
        }
      });
  }

  private runOnDiscordTurnCompleted(channelId: string): void {
    const callback = this.options.onDiscordTurnCompleted;
    if (!callback) {
      return;
    }

    void Promise.resolve(callback(channelId)).catch((error: unknown) => {
      logger.warn("Failed to run onDiscordTurnCompleted callback:", error);
    });
  }

  private async ensureRuntime(): Promise<AiRuntimePort> {
    if (this.runtime && this.runtimeInitialized) {
      return this.runtime;
    }

    if (this.runtimeInitialization) {
      return await this.runtimeInitialization;
    }

    if (!this.runtime) {
      this.runtime = this.options.createRuntime();
    }
    const runtime = this.runtime;

    const initialization = runtime
      .initialize()
      .then(() => {
        this.runtimeInitialized = true;
        return runtime;
      })
      .catch((error) => {
        if (this.runtime === runtime) {
          this.runtime = undefined;
        }
        this.runtimeInitialized = false;
        throw error;
      })
      .finally(() => {
        if (this.runtimeInitialization === initialization) {
          this.runtimeInitialization = undefined;
        }
      });

    this.runtimeInitialization = initialization;
    return await initialization;
  }

  private async resetRuntimeAndSession(): Promise<void> {
    await this.disposeDiscordSession();
    await this.resetRuntime();
  }

  private async resetRuntime(): Promise<void> {
    this.runtimeInitialization = undefined;
    this.runtimeInitialized = false;
    const runtime = this.runtime;
    this.runtime = undefined;
    if (!runtime) {
      return;
    }

    await runtime.close().catch((error: unknown) => {
      logger.warn("Failed to close runtime:", error);
    });
  }

  private async disposeDiscordSession(session?: DiscordSession): Promise<void> {
    const target = session ?? this.discordSession;
    if (!target) {
      return;
    }

    if (target.idleTimer) {
      this.clearTimeoutFn(target.idleTimer);
      target.idleTimer = undefined;
    }

    target.activeTurnId = undefined;
    target.turnCompletion = undefined;
    target.activeTurnChannelIds.clear();
    target.closeAfterTurn = false;

    if (this.discordSession === target) {
      this.discordSession = undefined;
    }
  }

  private async enqueueSessionOperation<T>(
    session: DiscordSession,
    operation: () => Promise<T>,
  ): Promise<T> {
    const chained = session.opChain.then(operation, operation);
    session.opChain = chained.then(
      () => undefined,
      () => undefined,
    );

    return await chained;
  }
}

function throwIfTurnFailed(turnResult: TurnResult): void {
  if (turnResult.status === "completed") {
    return;
  }

  const errorMessage = turnResult.errorMessage ?? `app-server turn status is ${turnResult.status}`;
  throw new TurnFailedError(errorMessage);
}

function createTurnObserver(context: TurnLogContext): TurnObserver {
  return {
    onMcpToolCallStarted: (event) => {
      logger.info("ai.turn.mcp_tool_call.started", {
        ...toTurnLogContextFields(context),
        server: event.server,
        threadId: event.threadId,
        tool: event.tool,
        turnId: event.turnId,
      });
    },
    onMcpToolCallCompleted: (event) => {
      logger.info("ai.turn.mcp_tool_call.completed", {
        ...toTurnLogContextFields(context),
        server: event.server,
        status: event.status,
        threadId: event.threadId,
        tool: event.tool,
        turnId: event.turnId,
      });
    },
  };
}

function logTurnStarted(context: TurnLogContext, threadId: string, turnId: string): void {
  logger.info("ai.turn.started", {
    ...toTurnLogContextFields(context),
    threadId,
    turnId,
  });
}

function logTurnResult(
  context: TurnLogContext,
  threadId: string,
  turnId: string,
  turnResult: TurnResult,
): void {
  logger.info("ai.turn.completed", {
    ...toTurnLogContextFields(context),
    errorMessage: turnResult.errorMessage,
    ...(turnResult.tokenUsage ? { tokenUsage: turnResult.tokenUsage } : {}),
    status: turnResult.status,
    threadId,
    turnId,
  });
}

function toTurnLogContextFields(context: TurnLogContext):
  | {
      source: "heartbeat";
    }
  | {
      source: "cron";
    }
  | {
      source: "discord";
      channelId: string;
      messageId: string;
    } {
  if (context.source === "heartbeat" || context.source === "cron") {
    return {
      source: context.source,
    };
  }

  return {
    channelId: context.channelId,
    messageId: context.messageId,
    source: "discord",
  };
}
