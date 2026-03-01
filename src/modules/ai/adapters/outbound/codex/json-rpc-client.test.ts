import { afterEach, describe, expect, it, vi } from "vitest";

import { logger } from "../../../../../shared/logger";

import { CLIENT_INFO, createJsonRpcClient } from "./json-rpc-client";
import type { StdioProcessHandle } from "./stdio-process";

describe("createJsonRpcClient", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("outbound request と inbound response を debug ログ出力する", async () => {
    const processHandle = new FakeStdioProcessHandle();
    const debugSpy = vi.spyOn(logger, "debug").mockImplementation(() => undefined);
    const rpcClient = createJsonRpcClient(processHandle);

    const requestPromise = rpcClient.request("initialize", {
      capabilities: null,
      clientInfo: CLIENT_INFO,
    });

    expect(processHandle.writeMessages).toEqual([
      {
        id: 1,
        method: "initialize",
        params: {
          capabilities: null,
          clientInfo: CLIENT_INFO,
        },
      },
    ]);
    expect(debugSpy).toHaveBeenNthCalledWith(1, "codex.rpc.request.outbound", {
      payload: {
        id: 1,
        method: "initialize",
        params: {
          capabilities: null,
          clientInfo: CLIENT_INFO,
        },
      },
    });

    processHandle.emitLine(
      JSON.stringify({
        id: 1,
        result: {
          ok: true,
        },
      }),
    );

    await expect(requestPromise).resolves.toEqual({
      ok: true,
    });
    expect(debugSpy).toHaveBeenNthCalledWith(2, "codex.rpc.response.inbound", {
      payload: {
        id: 1,
        result: {
          ok: true,
        },
      },
    });
  });

  it("inbound error response を reject し debug ログ出力する", async () => {
    const processHandle = new FakeStdioProcessHandle();
    const debugSpy = vi.spyOn(logger, "debug").mockImplementation(() => undefined);
    const rpcClient = createJsonRpcClient(processHandle);

    const requestPromise = rpcClient.request("turn/interrupt", {
      threadId: "thread-1",
      turnId: "turn-1",
    });

    processHandle.emitLine(
      JSON.stringify({
        error: {
          code: -32000,
          message: "interrupt failed",
        },
        id: 1,
      }),
    );

    await expect(requestPromise).rejects.toThrow("app-server error: -32000 interrupt failed");
    expect(debugSpy).toHaveBeenNthCalledWith(2, "codex.rpc.response.inbound", {
      payload: {
        error: {
          code: -32000,
          message: "interrupt failed",
        },
        id: 1,
      },
    });
  });

  it("id+method メッセージを server request として扱い response を返す", async () => {
    const processHandle = new FakeStdioProcessHandle();
    const debugSpy = vi.spyOn(logger, "debug").mockImplementation(() => undefined);
    createJsonRpcClient(processHandle);

    processHandle.emitLine(
      JSON.stringify({
        id: 99,
        method: "item/commandExecution/requestApproval",
        params: {},
      }),
    );

    await vi.waitFor(() => {
      expect(processHandle.writeMessages).toEqual([
        {
          id: 99,
          result: {
            decision: "decline",
          },
        },
      ]);
    });

    expect(debugSpy).toHaveBeenNthCalledWith(1, "codex.rpc.request.inbound", {
      payload: {
        id: 99,
        method: "item/commandExecution/requestApproval",
        params: {},
      },
    });
    expect(debugSpy).toHaveBeenNthCalledWith(2, "codex.rpc.response.outbound", {
      payload: {
        id: 99,
        result: {
          decision: "decline",
        },
      },
    });
  });

  it("未対応 server request にはエラー response を返し debug ログ出力する", async () => {
    const processHandle = new FakeStdioProcessHandle();
    const debugSpy = vi.spyOn(logger, "debug").mockImplementation(() => undefined);
    createJsonRpcClient(processHandle);

    processHandle.emitLine(
      JSON.stringify({
        id: "req-1",
        method: "item/unknown/request",
        params: {},
      }),
    );

    await vi.waitFor(() => {
      expect(processHandle.writeMessages).toEqual([
        {
          error: {
            code: -32601,
            message: "Unsupported client-side method: item/unknown/request",
          },
          id: "req-1",
        },
      ]);
    });

    expect(debugSpy).toHaveBeenNthCalledWith(1, "codex.rpc.request.inbound", {
      payload: {
        id: "req-1",
        method: "item/unknown/request",
        params: {},
      },
    });
    expect(debugSpy).toHaveBeenNthCalledWith(2, "codex.rpc.response.outbound", {
      payload: {
        error: {
          code: -32601,
          message: "Unsupported client-side method: item/unknown/request",
        },
        id: "req-1",
      },
    });
  });

  it("notification はハンドラへ渡し request/response debug ログは出さない", () => {
    const processHandle = new FakeStdioProcessHandle();
    const debugSpy = vi.spyOn(logger, "debug").mockImplementation(() => undefined);
    const rpcClient = createJsonRpcClient(processHandle);
    const onNotification = vi.fn();
    rpcClient.onNotification(onNotification);

    processHandle.emitLine(
      JSON.stringify({
        method: "turn/started",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
        },
      }),
    );

    expect(onNotification).toHaveBeenCalledTimes(1);
    expect(onNotification).toHaveBeenCalledWith({
      method: "turn/started",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
      },
    });
    expect(debugSpy).not.toHaveBeenCalled();
  });
});

class FakeStdioProcessHandle implements StdioProcessHandle {
  readonly close = vi.fn();
  readonly writeMessages: object[] = [];

  private readonly errorHandlers: Array<(error: Error) => void> = [];
  private readonly exitHandlers: Array<() => void> = [];
  private readonly lineHandlers: Array<(line: string) => void> = [];

  onError(handler: (error: Error) => void): void {
    this.errorHandlers.push(handler);
  }

  onExit(handler: () => void): void {
    this.exitHandlers.push(handler);
  }

  onLine(handler: (line: string) => void): void {
    this.lineHandlers.push(handler);
  }

  writeLine(message: object): void {
    this.writeMessages.push(message);
  }

  emitLine(line: string): void {
    for (const handler of this.lineHandlers) {
      handler(line);
    }
  }
}
