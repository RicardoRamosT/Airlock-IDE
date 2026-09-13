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
    hooks?: Record<
      string,
      { matcher?: string; hooks: { command: string }[] }[]
    >;
  };

describe("installDockStatusHooks", () => {
  it("registers our six events with AirLock-labeled commands", async () => {
    await installDockStatusHooks(p);
    const s = await readSettings();
    for (const ev of [
      "UserPromptSubmit",
      "PreToolUse",
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

  // Regression: the badge read idle for minutes while Claude was demonstrably
  // working. A turn can RESUME with no UserPromptSubmit (feeding bash-mode `!`
  // output back into the conversation is one real path) and its first act can be
  // a minutes-long tool call. PostToolUse only fires when that call RETURNS, so
  // with no tool-START edge the `done` latched by the previous Stop survived the
  // whole call -- and `working` is phase-gated, so the liveness heartbeat could
  // not rescue it. PreToolUse is that missing edge.
  it("re-asserts `working` at tool START, not only on completion", async () => {
    await installDockStatusHooks(p);
    const s = await readSettings();
    const cmd = (ev: string) => s.hooks?.[ev]?.[0]?.hooks?.[0]?.command ?? "";
    expect(cmd("PreToolUse")).toContain(" working  #");
    expect(cmd("PostToolUse")).toContain(" working  #");
    expect(cmd("Stop")).toContain(" done  #");
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

describe("Notification matcher", () => {
  it("only lets the three blocked-on-you notifications end a turn", async () => {
    // Notification fires for TWELVE different things (Claude Code hooks docs):
    // permission_prompt, idle_prompt, auth_success, four elicitation_*,
    // agent_needs_input, agent_completed, and three quota_auto_resume_*.
    // Registering it WITHOUT a matcher mapped all twelve to "done", so a
    // subagent finishing inside a running workflow (agent_completed) turned
    // the dot green mid-work -- and because isWorking gates on the phase, the
    // liveness heartbeat could not rescue it.
    await installDockStatusHooks(p);
    const entries = (await readSettings()).hooks?.Notification ?? [];
    expect(entries).toHaveLength(1);
    const matcher = entries[0]?.matcher ?? "";
    for (const kind of [
      "permission_prompt",
      "idle_prompt",
      "agent_needs_input",
    ])
      expect(matcher).toContain(kind);
    // The ones that must NOT end a turn. agent_completed is the workflow bug.
    for (const kind of ["agent_completed", "auth_success", "quota_auto_resume"])
      expect(matcher).not.toContain(kind);
    expect(entries[0]?.hooks[0]?.command).toContain("done");
  });

  it("leaves the other five events unmatched, so they fire for everything", async () => {
    await installDockStatusHooks(p);
    const hooks = (await readSettings()).hooks ?? {};
    for (const ev of [
      "UserPromptSubmit",
      "PreToolUse",
      "PostToolUse",
      "Stop",
      "SessionEnd",
    ])
      expect(hooks[ev]?.[0]?.matcher).toBeUndefined();
  });

  it("still removes the matched Notification entry on uninstall", async () => {
    await installDockStatusHooks(p);
    await uninstallDockStatusHooks(p);
    expect((await readSettings()).hooks?.Notification).toBeUndefined();
  });
});
