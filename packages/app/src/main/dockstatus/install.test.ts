import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type DockStatusPaths,
  installDockStatusHooks,
  isDockStatusInstalled,
  uninstallDockStatusHooks,
} from "./install";

let dir: string;
let p: DockStatusPaths;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "dockstatus-"));
  p = {
    settingsPath: path.join(dir, "settings.json"),
    bookkeepingPath: path.join(dir, "install.json"),
    emitConfigPath: path.join(dir, "emit-config.sh"),
    sessionsDir: path.join(dir, "sessions"),
    liveDir: path.join(dir, "live"),
    emitScript: "/opt/AirLock/resources/airlock-dock-status.sh",
  };
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const exists = async (f: string) =>
  access(f).then(
    () => true,
    () => false,
  );

const readSettings = async () =>
  JSON.parse(await readFile(p.settingsPath, "utf8")) as {
    hooks?: Record<string, { hooks: { command: string }[] }[]>;
  };

describe("installDockStatusHooks", () => {
  it("registers our five events with AirLock-labeled commands", async () => {
    await installDockStatusHooks(p);
    const s = await readSettings();
    for (const ev of [
      "UserPromptSubmit",
      "PostToolUse",
      "Stop",
      "Notification",
      "SessionEnd",
    ]) {
      const arr = s.hooks?.[ev];
      expect(arr, ev).toHaveLength(1);
      const cmd = arr?.[0]?.hooks?.[0]?.command ?? "";
      expect(cmd).toContain("airlock-dock-status.sh");
      expect(cmd).toContain("# AirLock dock-status indicator");
    }
    expect(await isDockStatusInstalled(p)).toBe(true);
    const cfg = await readFile(p.emitConfigPath, "utf8");
    expect(cfg).toContain("DIR=");
    // LIVE lets the SessionEnd hook clear the session's liveness file.
    expect(cfg).toContain(`LIVE='${p.liveDir}'`);
    // The live dir must exist -- its existence is what enables the quota emitter's
    // per-session liveness heartbeat.
    expect(await exists(p.liveDir)).toBe(true);
  });

  it("preserves a user's existing hook on the same event", async () => {
    await writeFile(
      p.settingsPath,
      JSON.stringify({
        hooks: {
          Stop: [{ hooks: [{ type: "command", command: "user-thing" }] }],
        },
      }),
    );
    await installDockStatusHooks(p);
    const stop = (await readSettings()).hooks?.Stop ?? [];
    expect(stop).toHaveLength(2);
    expect(JSON.stringify(stop)).toContain("user-thing");
    expect(JSON.stringify(stop)).toContain("airlock-dock-status.sh");
  });

  it("is idempotent (re-install does not duplicate ours)", async () => {
    await installDockStatusHooks(p);
    await installDockStatusHooks(p);
    expect((await readSettings()).hooks?.Stop).toHaveLength(1);
  });
});

describe("uninstallDockStatusHooks", () => {
  it("removes only ours and restores the user's hook", async () => {
    await writeFile(
      p.settingsPath,
      JSON.stringify({
        hooks: {
          Stop: [{ hooks: [{ type: "command", command: "user-thing" }] }],
        },
      }),
    );
    await installDockStatusHooks(p);
    await uninstallDockStatusHooks(p);
    const s = await readSettings();
    const stop = s.hooks?.Stop ?? [];
    expect(stop).toHaveLength(1);
    expect(JSON.stringify(stop)).toContain("user-thing");
    // events we added that had no user hook are removed entirely
    expect(s.hooks?.UserPromptSubmit).toBeUndefined();
    expect(s.hooks?.PostToolUse).toBeUndefined();
    expect(await isDockStatusInstalled(p)).toBe(false);
    // The live dir is gone, so the quota emitter stops writing heartbeats.
    expect(await exists(p.liveDir)).toBe(false);
  });
});
