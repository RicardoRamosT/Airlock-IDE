import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it } from "vitest";

// The PURE-SHELL emitter (intentionally not node -- see install.ts), invoked the
// way Claude Code runs the statusLine: `/bin/sh statusline-emit.sh <config>`.
const EMIT = fileURLToPath(
  new URL("../../../resources/statusline-emit.sh", import.meta.url),
);
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "quota-emit-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

// Write the shell-sourceable config (OUT/PRIOR) the way install.ts does, then run
// the emitter via /bin/sh with `input` on stdin.
function run(input: string, opts: { out?: string; prior?: string }) {
  const cfgPath = path.join(dir, "cfg.sh");
  writeFileSync(
    cfgPath,
    `OUT='${opts.out ?? ""}'\nPRIOR='${opts.prior ?? ""}'\n`,
  );
  return spawnSync("/bin/sh", [EMIT, cfgPath], { input, encoding: "utf8" });
}

it("siphons stdin verbatim to the out file (pure shell, no node)", () => {
  const out = path.join(dir, "rate-limits.json");
  const payload = JSON.stringify({
    rate_limits: { five_hour: { used_percentage: 12, resets_at: 1 } },
  });
  const r = run(payload, { out });
  expect(r.status).toBe(0);
  expect(readFileSync(out, "utf8")).toBe(payload);
});

it("chains a prior command and passes its stdout through", () => {
  const out = path.join(dir, "rate-limits.json");
  const r = run("hello-footer", { out, prior: "cat" });
  expect(r.stdout).toContain("hello-footer");
  expect(readFileSync(out, "utf8")).toBe("hello-footer");
});

it("does not crash when the config file is missing", () => {
  const r = spawnSync("/bin/sh", [EMIT, path.join(dir, "nope.sh")], {
    input: "{}",
    encoding: "utf8",
  });
  expect(r.status).toBe(0);
});
