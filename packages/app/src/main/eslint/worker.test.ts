// End-to-end: the real worker script driving a REAL ESLint 9 (the devDependency)
// in a throwaway project, exactly as main spawns it. This is the test that
// proves the project's own ESLint is found and its flat config applied.
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, expect, it } from "vitest";
import type { WorkerResponse } from "./protocol";
import { splitLines } from "./protocol";

const REPO = path.resolve(__dirname, "../../../../..");
const WORKER = path.resolve(__dirname, "../../../resources/eslint-worker.mjs");
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

// A project dir whose node_modules/eslint is the repo's copy, so createRequire
// from the project resolves it the way it would in a real repo.
function project(files: Record<string, string>, eslintAt = ""): string {
  const dir = mkdtempSync(path.join(tmpdir(), "airlock-eslint-"));
  dirs.push(dir);
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), body);
  }
  const nm = path.join(dir, eslintAt, "node_modules");
  mkdirSync(nm, { recursive: true });
  symlinkSync(path.join(REPO, "node_modules/eslint"), path.join(nm, "eslint"));
  return dir;
}

function lint(
  unit: string,
  file: string,
  text: string,
  env: Record<string, string> = {},
): Promise<WorkerResponse> {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [WORKER], {
      cwd: unit,
      stdio: "pipe",
      env: { ...process.env, ...env },
    });
    const feed = splitLines();
    let err = "";
    proc.stderr.on("data", (d) => {
      err += String(d);
    });
    proc.stdout.setEncoding("utf8");
    proc.stdout.on("data", (chunk: string) => {
      for (const line of feed(chunk)) {
        proc.kill();
        resolve(JSON.parse(line) as WorkerResponse);
      }
    });
    proc.on("exit", (code) => {
      if (code) reject(new Error(`worker exited ${code}: ${err}`));
    });
    proc.stdin.write(
      `${JSON.stringify({ id: 7, op: "lint", filePath: path.join(unit, file), text })}\n`,
    );
  });
}

const CONFIG = `export default [{ rules: { "no-var": "error", "prefer-const": "warn" } }];\n`;

it("runs the project's ESLint with its flat config, returning rules, severities and fixes", async () => {
  const dir = project({ "eslint.config.mjs": CONFIG, "package.json": "{}" });
  const r = await lint(
    dir,
    "a.js",
    "var x = 1;\nlet y = 2;\nconsole.log(x, y);\n",
  );
  expect(r.id).toBe(7);
  if (!("messages" in r))
    throw new Error(`expected messages, got ${JSON.stringify(r)}`);
  const noVar = r.messages.find((m) => m.ruleId === "no-var");
  const preferConst = r.messages.find((m) => m.ruleId === "prefer-const");
  expect(noVar).toMatchObject({ severity: 2, line: 1, column: 1 });
  expect(noVar?.fix).toEqual({ range: [0, 3], text: "let" });
  expect(preferConst).toMatchObject({ severity: 1, line: 2 });
}, 30000);

it("reports a config that throws as a configError, not as a crash", async () => {
  const dir = project({
    "eslint.config.mjs": `throw new Error("boom in config");\n`,
  });
  const r = await lint(dir, "a.js", "let a = 1;\n");
  expect(r).toMatchObject({ id: 7 });
  expect("configError" in r && r.configError).toMatch(/boom in config/);
}, 30000);

it("resolves a HOISTED ESLint for a subfolder unit with no package.json", async () => {
  const dir = project({ "web/eslint.config.mjs": CONFIG });
  const r = await lint(
    path.join(dir, "web"),
    "a.js",
    "var z = 1;\nconsole.log(z);\n",
  );
  if (!("messages" in r)) throw new Error(JSON.stringify(r));
  expect(r.messages.map((m) => m.ruleId)).toContain("no-var");
}, 30000);

it("returns nothing for a file the config ignores (no 'File ignored' warning)", async () => {
  const dir = project({
    "eslint.config.mjs": `export default [{ ignores: ["gen/**"] }, { rules: { "no-var": "error" } }];\n`,
  });
  const r = await lint(dir, "gen/a.js", "var q = 1;\n");
  expect(r).toEqual({ id: 7, messages: [] });
}, 30000);

// A project reached through a symlink: the worker's cwd is the REAL path, the
// file path main sends is the link path. Unreconciled, ESLint treats the file
// as outside its base path and silently ignores it -- a project that reads
// clean because it was never linted.
it("lints a project opened through a symlinked path", async () => {
  const real = project({ "eslint.config.mjs": CONFIG });
  const link = path.join(
    mkdtempSync(path.join(tmpdir(), "airlock-link-")),
    "proj",
  );
  dirs.push(path.dirname(link));
  symlinkSync(real, link);
  const r = await lint(link, "a.js", "var w = 1;\nconsole.log(w);\n");
  if (!("messages" in r)) throw new Error(JSON.stringify(r));
  expect(r.messages.map((m) => m.ruleId)).toContain("no-var");
}, 30000);

// SECURITY (final review, Critical): ESLint 10 looks configs up from the
// FILE's directory upward with no cwd boundary. A symlink inside a trusted unit
// pointing into another folder made it load and RUN that folder's untrusted
// config. ESLINT_FLAGS=v10_config_lookup_from_file reproduces ESLint 10's lookup on the ESLint 9
// devDependency. The worker must pin its own unit's config, so no lookup ever
// happens and no other config can execute.
it("never runs a config other than its own unit's, even under file-based lookup", async () => {
  const marker = path.join(
    tmpdir(),
    `airlock-untrusted-${process.pid}-${Date.now()}`,
  );
  const dir = project({
    "eslint.config.mjs": CONFIG,
    "other/eslint.config.mjs": `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(marker)}, "ran");\nexport default [];\n`,
    "other/lib/a.js": "var a = 1;\n",
  });
  mkdirSync(path.join(dir, "src"));
  symlinkSync(path.join(dir, "other/lib"), path.join(dir, "src/link"));
  await lint(dir, "src/link/a.js", "var a = 1;\n", {
    ESLINT_FLAGS: "v10_config_lookup_from_file",
  });
  expect(existsSync(marker)).toBe(false);
}, 30000);

// A long-lived worker answering several requests, like the pool uses it.
function session(unit: string) {
  const proc = spawn(process.execPath, [WORKER], { cwd: unit, stdio: "pipe" });
  const feed = splitLines();
  const waiting = new Map<number, (r: WorkerResponse) => void>();
  proc.stdout.setEncoding("utf8");
  proc.stdout.on("data", (chunk: string) => {
    for (const line of feed(chunk)) {
      const r = JSON.parse(line) as WorkerResponse;
      waiting.get(r.id)?.(r);
    }
  });
  let id = 0;
  return {
    lint(file: string, text: string): Promise<WorkerResponse> {
      const n = ++id;
      return new Promise((resolve) => {
        waiting.set(n, resolve);
        proc.stdin.write(
          `${JSON.stringify({ id: n, op: "lint", filePath: path.join(unit, file), text })}\n`,
        );
      });
    },
    close: () => proc.kill(),
  };
}

// Final review #3: ESLint caches the loaded config per engine, so a warm worker
// kept linting with the OLD rules after the user edited eslint.config.* --
// indefinitely, since an actively used worker never idles out.
it("picks up an edited config without a restart", async () => {
  const dir = project({
    "eslint.config.mjs": "export default [{ rules: {} }];\n",
  });
  const s = session(dir);
  try {
    const before = await s.lint("a.js", "var x = 1;\nconsole.log(x);\n");
    expect(before).toMatchObject({ messages: [] });
    writeFileSync(
      path.join(dir, "eslint.config.mjs"),
      `export default [{ rules: { "no-var": "error" } }];\n`,
    );
    // Guarantee a visible mtime change even on coarse-grained filesystems.
    const later = new Date(Date.now() + 5000);
    utimesSync(path.join(dir, "eslint.config.mjs"), later, later);
    const after = await s.lint("a.js", "var x = 1;\nconsole.log(x);\n");
    if (!("messages" in after)) throw new Error(JSON.stringify(after));
    expect(after.messages.map((m) => m.ruleId)).toContain("no-var");
  } finally {
    s.close();
  }
}, 30000);
