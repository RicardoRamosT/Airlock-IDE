#!/usr/bin/env node
// Post-build re-sign for `npm run package`.
//
// electron-builder `--dir` signs the app AD-HOC (identity "-"), and its signing
// runs AFTER any afterPack hook — so the macOS keychain can't pin "Always Allow"
// to it (ad-hoc cdhash changes every build) and secret prompts repeat forever.
// This script runs LAST (chained in the `package` npm script, after
// electron-builder has fully finished) and re-signs the app with a STABLE local
// code-signing identity, so its designated requirement (identifier
// com.ricardoramos.airlock + this cert) is constant across rebuilds: you
// Always-Allow once and it sticks.
//
// Opt-in + portable: no-op unless the identity is present, so CI / other
// machines / `dist:mac` distribution builds are unaffected.
// Identity: $AIRLOCK_SIGN_IDENTITY, else a cert named "AirLock Dev Signing".
//
// We intentionally do NOT use --options runtime: the working unsigned --dir
// build had no hardened runtime, and it's irrelevant to keychain pinning
// (which keys off the signature identity, not the runtime flag). Keeping the
// re-sign minimal avoids hardened-runtime launch surprises with a self-signed
// (untrusted-for-Gatekeeper) cert.
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

if (process.platform !== "darwin") process.exit(0);
const identity = process.env.AIRLOCK_SIGN_IDENTITY || "AirLock Dev Signing";

function identityExists(name) {
  try {
    // No -v: a self-signed dev cert is untrusted-for-Gatekeeper (hidden by -v)
    // yet still signs fine and pins keychain trust by its stable cert hash.
    return execFileSync("security", ["find-identity", "-p", "codesigning"], {
      encoding: "utf8",
    }).includes(name);
  } catch {
    return false;
  }
}

if (!identityExists(identity)) {
  console.log(
    `[sign-airlock] no code-signing identity "${identity}" in the keychain — ` +
      "leaving electron-builder's ad-hoc signature as-is. Create a self-signed " +
      '"Code Signing" cert with that name (or set AIRLOCK_SIGN_IDENTITY) for ' +
      "stable keychain trust.",
  );
  process.exit(0);
}

const appPath = path.join(
  __dirname,
  "..",
  "release",
  "mac-arm64",
  "AirLock.app",
);
if (!fs.existsSync(appPath)) {
  console.error(
    `[sign-airlock] app not found at ${appPath} — nothing to sign.`,
  );
  process.exit(1);
}
const entitlements = path.join(__dirname, "entitlements.mac.plist");

console.log(
  `[sign-airlock] re-signing AirLock.app with stable identity "${identity}"…`,
);
execFileSync(
  "codesign",
  [
    "--force",
    "--deep",
    "--entitlements",
    entitlements,
    "--sign",
    identity,
    appPath,
  ],
  { stdio: "inherit" },
);
execFileSync("codesign", ["--verify", "--verbose", appPath], {
  stdio: "inherit",
});
console.log(
  "[sign-airlock] done — AirLock.app is now a stable keychain principal.",
);
