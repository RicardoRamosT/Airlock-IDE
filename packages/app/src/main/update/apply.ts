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
import { access, constants, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { chooseUpdateAction } from "@airlock/agent-core";
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
  const chunks: Uint8Array[] = [];
  let got = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    if (total > 0)
      emit({ phase: "downloading", percent: Math.round((got / total) * 100) });
  }
  await writeFile(dest, Buffer.concat(chunks));
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

export async function applyUpdate(): Promise<void> {
  const u = getUpdate();
  if (!app.isPackaged) {
    emit({ phase: "error", message: "Updates only apply to the packaged app" });
    return;
  }
  if (!u?.available || !u.dmgUrl) {
    emit({ phase: "error", message: "No update available" });
    return;
  }
  let mountPoint: string | null = null;
  try {
    const dmg = await downloadDmg(u.dmgUrl);
    emit({ phase: "mounting" });
    mountPoint = await mount(dmg);
    const srcApp = path.join(mountPoint, "AirLock.app");

    // The running bundle: exe is <bundle>/Contents/MacOS/AirLock.
    const appBundle = path.resolve(app.getPath("exe"), "..", "..", "..");
    const installDir = path.dirname(appBundle);
    const writable = await access(installDir, constants.W_OK)
      .then(() => true)
      .catch(() => false);

    if (chooseUpdateAction({ installDirWritable: writable }) === "reveal") {
      await detach(mountPoint);
      shell.showItemInFolder(dmg);
      emit({ phase: "revealed" });
      return;
    }

    emit({ phase: "swapping" });
    // Detached relaunch script: wait for THIS process to exit, replace the
    // bundle, strip quarantine, detach, relaunch. Runs after app.quit().
    const script = path.join(tmpdir(), "airlock-update.sh");
    await writeFile(
      script,
      [
        "#!/bin/bash",
        `while kill -0 ${process.pid} 2>/dev/null; do sleep 0.3; done`,
        `rm -rf "${appBundle}"`,
        `cp -R "${srcApp}" "${appBundle}"`,
        `xattr -dr com.apple.quarantine "${appBundle}" 2>/dev/null`,
        `hdiutil detach "${mountPoint}" 2>/dev/null`,
        `open "${appBundle}"`,
      ].join("\n"),
      { mode: 0o755 },
    );
    const child = spawn("/bin/bash", [script], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    emit({ phase: "relaunching" });
    app.quit();
  } catch (e) {
    if (mountPoint) await detach(mountPoint);
    emit({
      phase: "error",
      message: e instanceof Error ? e.message : String(e),
    });
  }
}
