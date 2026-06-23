// electron-builder afterPack hook: re-sign the packaged .app with a STABLE,
// local self-signed code-signing identity so the macOS keychain can PIN an
// "Always Allow" across rebuilds.
//
// Why: the default `npm run package` (`electron-builder --dir`) build is only
// linker-signed — identity "Electron", ad-hoc, cdhash changes every build — so
// the keychain treats each build as a new, untrusted principal and re-prompts
// for the `airlock` secret items forever ("Always Allow" can't stick to an
// ad-hoc signature). Re-signing with a stable cert (and the app's real
// CFBundleIdentifier, com.ricardoramos.airlock) makes it one consistent
// principal: you Always-Allow once and it sticks across future rebuilds.
//
// Opt-in + portable: signs ONLY if a usable identity is found, else it's a
// no-op — so CI, other machines, and `dist:mac` for distribution are
// unaffected. Identity resolution: $AIRLOCK_SIGN_IDENTITY, else a cert named
// "AirLock Dev Signing" present in the login keychain.
const { execFileSync } = require("node:child_process");
const path = require("node:path");

const DEFAULT_IDENTITY = "AirLock Dev Signing";

function identityExists(name) {
  try {
    // No -v: a self-signed dev cert is "not trusted" for Gatekeeper (so -v
    // hides it) yet still signs fine and pins keychain trust by its stable
    // cert hash. Match it by name among all code-signing identities.
    const out = execFileSync(
      "security",
      ["find-identity", "-p", "codesigning"],
      { encoding: "utf8" },
    );
    return out.includes(name);
  } catch {
    return false;
  }
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;
  const identity = process.env.AIRLOCK_SIGN_IDENTITY || DEFAULT_IDENTITY;
  if (!identityExists(identity)) {
    console.log(
      `[afterPack] no code-signing identity "${identity}" in the keychain — ` +
        "leaving signing as-is. Create a self-signed \"Code Signing\" cert " +
        "with that name (or set AIRLOCK_SIGN_IDENTITY) for stable keychain trust.",
    );
    return;
  }
  const appName = `${context.packager.appInfo.productFilename}.app`;
  const appPath = path.join(context.appOutDir, appName);
  const entitlements = path.join(__dirname, "entitlements.mac.plist");
  console.log(`[afterPack] re-signing ${appName} with stable identity "${identity}"…`);
  execFileSync(
    "codesign",
    [
      "--force",
      "--deep",
      "--options",
      "runtime",
      "--entitlements",
      entitlements,
      "--sign",
      identity,
      appPath,
    ],
    { stdio: "inherit" },
  );
  console.log(`[afterPack] done — ${appName} is now a stable keychain principal.`);
};
