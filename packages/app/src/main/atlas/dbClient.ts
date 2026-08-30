// ASCII comments only. Main-side proxy for the Atlas database, which lives in
// the separate process started by dbHost.ts. See that file for why.
//
// The contract this file must keep: NO failure of the host may propagate as a
// failure of AirLock. A crashed host, a host that never starts, and a host that
// wedges all surface as one rejected promise on one Atlas call. The callers
// already treat a store failure as "Atlas could not answer", which is a far
// better outcome than the alternative this replaces.
//
// The process is INJECTED rather than forked here, so all of this logic is
// unit-tested against a fake and only the one-line electron call in db.ts is
// not -- the project's usual split for electron wiring.

import {
  type AtlasDb,
  DB_OP_NAMES,
  type DbOpName,
  type DbRequest,
  type DbResponse,
} from "./dbOps";

// The slice of a utilityProcess this client actually uses.
export interface HostProcess {
  on(event: "message", listener: (msg: DbResponse) => void): void;
  once(event: "exit", listener: (code: number) => void): void;
  postMessage(msg: DbRequest): void;
}

export interface DbClientDeps {
  fork(): HostProcess;
  // Every operation is a handful of small SQLite statements, so a call that has
  // not answered in this long is wedged, not slow. Without a timeout a stuck
  // host would hang Atlas forever -- reintroducing, as a hang, the very
  // unbounded failure this design exists to remove.
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;

interface Pending {
  resolve(value: unknown): void;
  reject(err: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

export function createDbClient(deps: DbClientDeps): AtlasDb {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let child: HostProcess | null = null;
  let nextId = 1;
  const pending = new Map<number, Pending>();

  // One place that ends a call, so a timeout, a crash and a reply can never
  // double-settle the same promise or leak its timer.
  function settle(id: number, apply: (p: Pending) => void): void {
    const p = pending.get(id);
    if (p === undefined) return;
    pending.delete(id);
    clearTimeout(p.timer);
    apply(p);
  }

  function failAll(reason: string): void {
    for (const id of [...pending.keys()]) {
      settle(id, (p) => p.reject(new Error(reason)));
    }
  }

  function start(): HostProcess {
    const proc = deps.fork();
    proc.on("message", (msg: DbResponse) => {
      if (!msg || typeof msg.id !== "number") return;
      settle(msg.id, (p) =>
        msg.ok ? p.resolve(msg.value) : p.reject(new Error(msg.error)),
      );
    });
    // The whole point of the design. An abort in the host lands HERE instead of
    // killing AirLock: in-flight calls fail, and `child` is cleared so the very
    // next call starts a fresh host.
    proc.once("exit", (code) => {
      if (child === proc) child = null;
      failAll(`atlas db host exited (${code})`);
    });
    return proc;
  }

  function call(op: DbOpName, args: unknown[]): Promise<unknown> {
    let proc: HostProcess;
    try {
      if (child === null) child = start();
      proc = child;
    } catch (e) {
      // Could not even start the host. Still just one failed Atlas call.
      const why = e instanceof Error ? e.message : String(e);
      return Promise.reject(new Error(`atlas db host failed to start: ${why}`));
    }
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        settle(id, (p) => p.reject(new Error(`atlas db op timed out: ${op}`)));
      }, timeoutMs);
      // Never let a pending Atlas call hold up quitting.
      timer.unref?.();
      pending.set(id, { resolve, reject, timer });
      try {
        proc.postMessage({ id, op, args });
      } catch (e) {
        // The host died between the spawn and the send.
        const why = e instanceof Error ? e.message : String(e);
        settle(id, (p) => p.reject(new Error(`atlas db send failed: ${why}`)));
      }
    });
  }

  // Built from DB_OP_NAMES rather than written out, so the client cannot drift
  // from the op table: adding a store operation adds its method here for free.
  const api = {} as Record<string, (...args: unknown[]) => Promise<unknown>>;
  for (const op of DB_OP_NAMES) {
    api[op] = (...args: unknown[]) => call(op, args);
  }
  return api as AtlasDb;
}
