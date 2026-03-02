import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import * as readline from "node:readline";

export type StdioProcessOptions = {
  command: readonly [string, ...string[]];
  codexHomeDir: string;
  cwd: string;
};

export type StdioProcessHandle = {
  close: () => Promise<void>;
  onError: (handler: (error: Error) => void) => void;
  onExit: (handler: () => void) => void;
  onLine: (handler: (line: string) => void) => void;
  writeLine: (message: object) => void;
};

export function startStdioProcess(options: StdioProcessOptions): StdioProcessHandle {
  const [command, ...args] = options.command;
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: {
      ...process.env,
      CODEX_HOME: options.codexHomeDir,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  const lineReader = readline.createInterface({
    input: child.stdout,
  });
  // Drain stderr to avoid deadlocks when app-server writes large logs.
  child.stderr.on("data", () => undefined);

  return createHandle(child, lineReader);
}

function createHandle(
  child: ChildProcessWithoutNullStreams,
  lineReader: readline.Interface,
): StdioProcessHandle {
  const waitForExit = (): Promise<void> => {
    return new Promise((resolve) => {
      child.once("exit", () => {
        resolve();
      });
    });
  };

  return {
    close: async () => {
      lineReader.close();
      if (child.exitCode !== null || child.signalCode !== null) {
        return;
      }

      const exitPromise = waitForExit();
      child.kill("SIGTERM");
      const exitedAfterTerm = await Promise.race([exitPromise.then(() => true), wait(1_000)]);
      if (exitedAfterTerm) {
        return;
      }

      child.kill("SIGKILL");
      await Promise.race([exitPromise, wait(1_000)]);
    },
    onError: (handler) => {
      child.on("error", handler);
    },
    onExit: (handler) => {
      child.on("exit", handler);
    },
    onLine: (handler) => {
      lineReader.on("line", handler);
    },
    writeLine: (message) => {
      child.stdin.write(`${JSON.stringify(message)}\n`);
    },
  };
}

async function wait(ms: number): Promise<false> {
  return await new Promise((resolve) => {
    setTimeout(() => {
      resolve(false);
    }, ms);
  });
}
