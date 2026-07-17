import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";

const SCRIPT = path.join(
  __dirname,
  "../../../resources/airlock-dock-status.sh",
);
let dir: string;
let sessions: string;
let config: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "emit-"));
  sessions = path.join(dir, "sessions");
  config = path.join(dir, "emit-config.sh");
  await writeFile(config, `DIR='${sessions}'\n`);
});
afterEach(() => rm(dir, { recursive: true, force: true }));

function run(state: string, stdin: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ps = spawn("/bin/sh", [SCRIPT, config, state]);
    ps.on("error", reject);
    ps.on("close", () => resolve());
    ps.stdin.end(stdin);
  });
}

it("writes '<state> <ts>' to the session file", async () => {
  await run(
    "working",
    '{"session_id":"abc-123","hook_event_name":"UserPromptSubmit"}',
  );
  const body = await readFile(path.join(sessions, "abc-123"), "utf8");
  expect(body).toMatch(/^working \d+$/m);
});

it("removes the session file on 'gone'", async () => {
  await run("done", '{"session_id":"s1"}');
  expect(existsSync(path.join(sessions, "s1"))).toBe(true);
  await run("gone", '{"session_id":"s1"}');
  expect(existsSync(path.join(sessions, "s1"))).toBe(false);
});

it("no session_id -> no file written, no crash", async () => {
  await run("working", "{}");
  expect(existsSync(path.join(sessions, "undefined"))).toBe(false);
});
