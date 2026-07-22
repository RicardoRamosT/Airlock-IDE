import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseDevManifest } from "@airlock/agent-core";
import { afterEach, beforeEach, expect, it } from "vitest";

const SCRIPT = fileURLToPath(
  new URL("../../../build/write-dev-manifest.cjs", import.meta.url),
);
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "devman-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

it("writes a dev-update.json the reader accepts", () => {
  const r = spawnSync("node", [SCRIPT], {
    encoding: "utf8",
    env: {
      ...process.env,
      AIRLOCK_USERDATA: dir,
      AIRLOCK_DEV_APP_PATH: "/tmp/AirLock.app",
      AIRLOCK_DEV_VERSION: "9.9.9",
    },
  });
  expect(r.status).toBe(0);
  const raw = readFileSync(path.join(dir, "dev-update.json"), "utf8");
  const m = parseDevManifest(JSON.parse(raw));
  expect(m).not.toBeNull();
  expect(m?.appPath).toBe("/tmp/AirLock.app");
  expect(m?.version).toBe("9.9.9");
  expect(m?.builtAt).toBeGreaterThan(0);
});
