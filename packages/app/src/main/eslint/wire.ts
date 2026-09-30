// wire.ts -- the Electron edge of ESLint-in-the-editor: where the worker script
// lives, how a worker process is spawned, and where the trust store is kept.
// Kept thin and untested by design (the repo's rule for electron wiring); the
// logic it connects -- unit, trust, pool, service -- is all unit-tested.
import { spawn } from "node:child_process";
import {
  existsSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { app } from "electron";
import { EslintPool, type WorkerProc } from "./pool";
import { splitLines } from "./protocol";
import { createEslintService, type EslintService } from "./service";
import { type TrustFs, TrustStore } from "./trust";

// Shipped via extraResources in production (a child process cannot load from
// the asar); in dev it sits in the repo, resolved from the built main dir
// (out/main -> ../../resources) -- the quota emitter's pattern.
function workerScript(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "eslint-worker.mjs")
    : path.join(__dirname, "../../resources/eslint-worker.mjs");
}

// Electron's own binary as plain Node, like the TypeScript server. The env is
// main's as-is: vaulted secrets are only ever injected into ptys, never here --
// a repo's lint config has no business seeing DATABASE_URL.
function spawnWorker(unitAbs: string): WorkerProc {
  const proc = spawn(process.execPath, [workerScript()], {
    cwd: unitAbs,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const lineCbs: ((l: string) => void)[] = [];
  const exitCbs: (() => void)[] = [];
  let exited = false;
  const fireExit = () => {
    if (exited) return;
    exited = true;
    for (const cb of exitCbs) cb();
  };
  const feed = splitLines();
  proc.stdout?.setEncoding("utf8");
  proc.stdout?.on("data", (chunk: string) => {
    for (const line of feed(chunk)) for (const cb of lineCbs) cb(line);
  });
  proc.stderr?.on("data", (d) => console.error("[eslint]", String(d).trim()));
  proc.on("exit", fireExit);
  proc.on("error", (err) => {
    console.error("[eslint] worker failed", err);
    fireExit();
  });
  return {
    write: (line) => {
      if (proc.stdin && !proc.stdin.destroyed) proc.stdin.write(line);
    },
    onLine: (cb) => void lineCbs.push(cb),
    onExit: (cb) => void exitCbs.push(cb),
    kill: () => {
      proc.stdin?.end(); // the worker exits on stdin end; kill in case it hangs
      proc.kill();
    },
  };
}

const nodeTrustFs: TrustFs = {
  read: (f) => {
    try {
      return readFileSync(f, "utf8");
    } catch {
      return null;
    }
  },
  write: (f, data) => {
    const tmp = `${f}.tmp`;
    writeFileSync(tmp, data, { mode: 0o600 });
    renameSync(tmp, f);
  },
  realpath: (p) => {
    try {
      return realpathSync.native(p);
    } catch {
      return null;
    }
  },
};

let pool: EslintPool | null = null;
let service: EslintService | null = null;

export function eslintService(): EslintService {
  if (!service) {
    pool = new EslintPool(spawnWorker);
    service = createEslintService({
      exists: existsSync,
      trust: new TrustStore(
        path.join(app.getPath("userData"), "eslint-trust.json"),
        nodeTrustFs,
      ),
      pool,
    });
  }
  return service;
}

// Called with the full open-root set wherever syncLspServers is.
export function syncEslint(openRoots: string[]): void {
  pool?.retainOnly(openRoots);
}

export function disposeAllEslint(): void {
  pool?.disposeAll();
}
