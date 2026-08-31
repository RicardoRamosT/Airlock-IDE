// One-click in-place updater for the ad-hoc-signed app (electron-updater cannot
// apply an unsigned update). Downloads the release DMG (main fetches it, so the
// file carries NO com.apple.quarantine xattr), mounts it, and either swaps the
// running .app bundle in place + relaunches, or -- when the install dir is not
// writable -- reveals the DMG for a manual drag-install. THIN + UNTESTED by
// convention: the decidable parts (chooseUpdateAction, version compare, asset
// pick) are pure and tested in agent-core; this is the shell orchestration.
//
// ASCII-only comments (CJS-bundled into Electron main).
import { execFile as execFileCb, spawn } from "node:child_process";
import { once } from "node:events";
import { createWriteStream } from "node:fs";
import { access, constants, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { chooseUpdateAction, pickUpdateSource } from "@airlock/agent-core";
import { app, BrowserWindow, shell } from "electron";
import type { UpdateProgress } from "../../shared/ipc";
import { getUpdate } from "./check";

const execFile = promisify(execFileCb);

function emit(p: UpdateProgress): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.webContents.isDestroyed()) w.webContents.send("update:progress", p);
  }
}

async function downloadDmg(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok || !res.body)
    throw new Error(`download ${res.status} ${res.statusText}`);
  const total = Number(res.headers.get("content-length") ?? 0);
  const dest = path.join(tmpdir(), "AirLock-update.dmg");
  // STREAM to disk. Accumulating chunks and then Buffer.concat holds the whole
  // DMG in memory TWICE at the moment of the concat -- ~250MB of main-process
  // heap for a 124MB image, on the process that also owns every window and pty.
  // Nothing here needs the bytes in memory; they go straight to a temp file.
  let got = 0;
  const out = createWriteStream(dest);
  try {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!out.write(value)) {
        // Respect backpressure, or a fast link buries the stream's buffer and
        // we are back to holding the file in memory by another route.
        await once(out, "drain");
      }
      got += value.length;
      if (total > 0)
        emit({
          phase: "downloading",
          percent: Math.round((got / total) * 100),
        });
    }
    out.end();
    await once(out, "finish");
  } catch (e) {
    out.destroy();
    await rm(dest, { force: true }).catch(() => {});
    throw e;
  }
  return dest;
}

// `hdiutil attach -nobrowse -noverify <dmg>` -> the mount point (last column of
// the last output line that contains a /Volumes path).
async function mount(dmg: string): Promise<string> {
  const { stdout } = await execFile("hdiutil", [
    "attach",
    "-nobrowse",
    "-noverify",
    dmg,
  ]);
  const line = stdout
    .trim()
    .split("\n")
    .reverse()
    .find((l) => l.includes("/Volumes/"));
  const mountPoint = line?.split("\t").pop()?.trim();
  if (!mountPoint) throw new Error("could not parse hdiutil mount point");
  return mountPoint;
}

async function detach(mountPoint: string): Promise<void> {
  await execFile("hdiutil", ["detach", mountPoint]).catch(() => {});
}

// Re-entrancy guard: only one apply may be in flight. The renderer disables the
// button while busy, but a second window or an automation caller could fire
// update:apply again -- two concurrent downloads + relaunch scripts racing on
// the same bundle is the one path that could corrupt the install.
//
// Reset in a FINALLY, not on the individual exits. It used to be cleared in the
// reveal branch and in the catch, which leaks the guard if the catch itself
// throws (`await detach()` on a busy mount does exactly that) -- and then
// updating is wedged for the rest of the session with nothing logged. The swap
// path also ends here now: it calls app.quit(), but a quit can be VETOED by a
// before-quit handler, and the old code left the guard latched forever in that
// case with no way to retry.
let applying = false;

export async function applyUpdate(): Promise<void> {
  const u = getUpdate();
  if (!app.isPackaged) {
    emit({ phase: "error", message: "Updates only apply to the packaged app" });
    return;
  }
  const source = u
    ? pickUpdateSource({ localAppPath: u.localAppPath, dmgUrl: u.dmgUrl })
    : null;
  if (!u?.available || !source) {
    emit({ phase: "error", message: "No update available" });
    return;
  }
  if (applying) return;
  applying = true;
  let mountPoint: string | null = null;
  try {
    // Resolve the new bundle. Local dev channel: use the built .app directly (no
    // download / mount). GitHub: download the DMG and mount it.
    let srcApp: string;
    if (source.kind === "local") {
      srcApp = source.appPath;
    } else {
      const dmg = await downloadDmg(source.url);
      emit({ phase: "mounting" });
      mountPoint = await mount(dmg);
      srcApp = path.join(mountPoint, "AirLock.app");
    }

    // The running bundle: exe is <bundle>/Contents/MacOS/AirLock.
    const appBundle = path.resolve(app.getPath("exe"), "..", "..", "..");
    const installDir = path.dirname(appBundle);
    const writable = await access(installDir, constants.W_OK)
      .then(() => true)
      .catch(() => false);

    if (chooseUpdateAction({ installDirWritable: writable }) === "reveal") {
      if (mountPoint) await detach(mountPoint);
      shell.showItemInFolder(srcApp);
      emit({ phase: "revealed" });
      return;
    }

    emit({ phase: "swapping" });
    // Detached relaunch script: wait for THIS process to exit, stage the new
    // bundle as a sibling, strip quarantine, atomic mv swap, relaunch. Runs
    // after app.quit().
    //
    // Copy the new bundle to a temp SIBLING first, then swap it in with `mv`
    // (an atomic rename within the same volume). This avoids the data-loss
    // window of an `rm` of the live bundle followed by a multi-second `cp`: if
    // the copy fails (disk full, mount lost, sleep/power-loss), the old bundle
    // is still intact and we exit non-zero rather than leaving NO app
    // installed. The remaining rm->mv gap is a sub-millisecond rename. The
    // hdiutil detach lines are included only when we mounted a DMG.
    const script = path.join(tmpdir(), "airlock-update.sh");
    const lines = [
      "#!/bin/bash",
      `while kill -0 ${process.pid} 2>/dev/null; do sleep 0.3; done`,
      `staged="${appBundle}.new.$$"`,
      `rm -rf "$staged"`,
      `cp -R "${srcApp}" "$staged" || { ${mountPoint ? `hdiutil detach "${mountPoint}" 2>/dev/null; ` : ""}exit 1; }`,
      `xattr -dr com.apple.quarantine "$staged" 2>/dev/null`,
      `rm -rf "${appBundle}"`,
      `mv "$staged" "${appBundle}"`,
    ];
    if (mountPoint) lines.push(`hdiutil detach "${mountPoint}" 2>/dev/null`);
    lines.push(`open "${appBundle}"`);
    await writeFile(script, lines.join("\n"), { mode: 0o755 });
    const child = spawn("/bin/bash", [script], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    emit({ phase: "relaunching" });
    app.quit();
  } catch (e) {
    // Never let cleanup mask the real failure, or throw out of the catch.
    if (mountPoint) await detach(mountPoint).catch(() => {});
    emit({
      phase: "error",
      message: e instanceof Error ? e.message : String(e),
    });
  } finally {
    applying = false;
  }
}
