import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it } from "vitest";

const EMIT = fileURLToPath(new URL("../../../resources/statusline-emit.cjs", import.meta.url));
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "quota-emit-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function run(input: string, cfg: object) {
  const cfgPath = path.join(dir, "cfg.json");
  writeFileSync(cfgPath, JSON.stringify(cfg));
  return spawnSync(process.execPath, [EMIT, cfgPath], { input, encoding: "utf8" });
}

it("siphons stdin verbatim to the out file", () => {
  const out = path.join(dir, "rate-limits.json");
  const payload = JSON.stringify({ rate_limits: { five_hour: { used_percentage: 12, resets_at: 1 } } });
  const r = run(payload, { out, prior: null });
  expect(r.status).toBe(0);
  expect(readFileSync(out, "utf8")).toBe(payload);
});

it("chains a prior command and passes its stdout through", () => {
  const out = path.join(dir, "rate-limits.json");
  const r = run("hello-footer", { out, prior: { type: "command", command: "cat" } });
  expect(r.stdout).toContain("hello-footer");
  expect(readFileSync(out, "utf8")).toBe("hello-footer");
});

it("does not crash when the config file is missing", () => {
  const r = spawnSync(process.execPath, [EMIT, path.join(dir, "nope.json")], {
    input: "{}",
    encoding: "utf8",
  });
  expect(r.status).toBe(0);
});
