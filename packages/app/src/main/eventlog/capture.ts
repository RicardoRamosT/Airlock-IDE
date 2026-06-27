import type { IpcMain } from "electron";
import { emitEvent } from "./wire";

// Wrap ipcMain.handle so EVERY renderer->main call is logged with its outcome
// and duration. Must run before handlers are registered. Logging is best-effort
// and never changes the handler's result or thrown error.
export function wrapIpcHandle(ipcMain: IpcMain): void {
  const orig = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = ((
    channel: string,
    listener: (...args: unknown[]) => unknown,
  ) => {
    return orig(channel, async (...args: unknown[]) => {
      const startedAt = performanceNow();
      try {
        const result = await (listener as (...a: unknown[]) => unknown)(
          ...args,
        );
        emitEvent({
          level: "debug",
          category: "ipc",
          op: `ipc.${channel}`,
          outcome: "ok",
          durationMs: Math.round(performanceNow() - startedAt),
        });
        return result;
      } catch (e) {
        emitEvent({
          level: "error",
          category: "ipc",
          op: `ipc.${channel}`,
          outcome: "error",
          durationMs: Math.round(performanceNow() - startedAt),
          error: errorOf(e),
        });
        throw e; // preserve the contract: the renderer still sees the failure
      }
    });
  }) as IpcMain["handle"];
}

// console.error/warn -> the log, without losing the original console output.
export function installConsoleFunnel(): void {
  for (const [method, level] of [
    ["error", "error"],
    ["warn", "warn"],
  ] as const) {
    const orig = console[method].bind(console);
    console[method] = (...args: unknown[]) => {
      try {
        emitEvent({
          level,
          category: "console",
          op: `console.${method}`,
          detail: { message: args.map(stringifyArg).join(" ") },
        });
      } catch {
        /* never let logging break console */
      }
      orig(...args);
    };
  }
}

// Turn would-be crashes into logged errors (and a crash-safety win).
export function installProcessHandlers(): void {
  process.on("uncaughtException", (e) => {
    emitEvent({
      level: "error",
      category: "process",
      op: "uncaughtException",
      error: errorOf(e),
    });
  });
  process.on("unhandledRejection", (reason) => {
    emitEvent({
      level: "error",
      category: "process",
      op: "unhandledRejection",
      error: errorOf(reason),
    });
  });
}

function errorOf(e: unknown): { message: string; stack?: string } {
  if (e instanceof Error) return { message: e.message, stack: e.stack };
  return { message: String(e) };
}

function stringifyArg(a: unknown): string {
  if (typeof a === "string") return a;
  try {
    return JSON.stringify(a);
  } catch {
    return String(a);
  }
}

function performanceNow(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}
