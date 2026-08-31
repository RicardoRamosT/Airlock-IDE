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

// An ERROR must survive this, and JSON.stringify destroys one: an Error has no
// enumerable own properties, so `JSON.stringify(new Error("EMFILE"))` is "{}".
// That silently gutted every `console.error("msg", err)` in main -- 24+ call
// sites, including the LSP spawn failures and `session.json write failed` --
// and produced 106 identical "[fsWatch] watch error for <root>: {}" entries
// over five days: the one recurring failure in normal use, logged in the one
// form that makes it undiagnosable.
function stringifyArg(a: unknown): string {
  if (typeof a === "string") return a;
  if (a instanceof Error) {
    // The stack already begins with "Name: message", so it is the better
    // single string when present. Node's `code`/`errno` (EMFILE, EPERM) live
    // off-prototype and are exactly what a watcher failure needs, so carry
    // them explicitly.
    const extra = [];
    for (const k of ["code", "errno", "syscall", "path"]) {
      const v = (a as unknown as Record<string, unknown>)[k];
      if (v !== undefined) extra.push(`${k}=${String(v)}`);
    }
    const head = a.stack ?? `${a.name}: ${a.message}`;
    return extra.length > 0 ? `${head} (${extra.join(" ")})` : head;
  }
  try {
    // A circular object would throw; String() is the honest fallback.
    return JSON.stringify(a) ?? String(a);
  } catch {
    return String(a);
  }
}

function performanceNow(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}
