#!/usr/bin/env node
"use strict";
// AirLock Claude quota statusLine emitter. Claude Code pipes the statusLine
// JSON to this command on stdin and uses its stdout as the footer text.
//
// We (1) siphon: atomically write the raw payload to a side-channel file that
// AirLock's main process watches + parses, and (2) chain: re-feed the SAME
// stdin to any pre-existing user statusLine and pass its stdout through, so the
// user's footer is untouched. Config (out path + prior command) is a JSON file
// whose path is argv[2]. Pure CJS, zero deps -- runs under the app's own
// Electron-as-node in production and `node` in dev (no PATH assumptions).
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");

function readStdin() {
  try {
    return fs.readFileSync(0, "utf8"); // fd 0; Claude Code always pipes here
  } catch {
    return "";
  }
}

function main() {
  const input = readStdin();
  let cfg = {};
  try {
    cfg = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  } catch {
    // No/invalid config -> nothing to siphon to and no prior to chain.
  }

  if (cfg && typeof cfg.out === "string") {
    try {
      const tmp = `${cfg.out}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, input);
      fs.renameSync(tmp, cfg.out);
    } catch {
      // Best-effort: a write failure must never break Claude Code's footer.
    }
  }

  const prior = cfg && cfg.prior;
  if (prior && prior.type === "command" && typeof prior.command === "string") {
    // Run the user's prior statusLine in a CLEAN env: we are launched with
    // ELECTRON_RUN_AS_NODE=1 (so the app's Electron binary runs this as node),
    // but leaving that set would make any Electron-based prior command behave as
    // raw node and silently break their footer -- strip it. A timeout guarantees
    // a slow/hanging prior can never stall Claude Code's footer.
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const r = spawnSync(prior.command, {
      input,
      shell: true,
      encoding: "utf8",
      env,
      timeout: 2000,
      killSignal: "SIGKILL",
      maxBuffer: 1024 * 1024,
    });
    if (r && r.stdout) process.stdout.write(r.stdout);
  }
}

main();
