#!/usr/bin/env node
// Writes <userData>/dev-update.json after a `package:dev` build so the running
// dev-flavored AirLock's update watcher offers the freshly built bundle.
// DEV ONLY: never invoked in release builds; the code that reads this file is
// compiled out of release (see __AIRLOCK_DEV_UPDATE__).
//
// Env overrides (used by the test): AIRLOCK_USERDATA, AIRLOCK_DEV_APP_PATH,
// AIRLOCK_DEV_VERSION.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const appDir = path.resolve(__dirname, ".."); // packages/app
const userData =
  process.env.AIRLOCK_USERDATA ||
  path.join(os.homedir(), "Library", "Application Support", "airlock");
const appPath =
  process.env.AIRLOCK_DEV_APP_PATH ||
  path.join(appDir, "release", "mac-arm64", "AirLock.app");
const version =
  process.env.AIRLOCK_DEV_VERSION ||
  require(path.join(appDir, "package.json")).version;
const builtAt = Date.now();

fs.mkdirSync(userData, { recursive: true });
const out = path.join(userData, "dev-update.json");
const tmp = `${out}.${process.pid}.tmp`;
fs.writeFileSync(
  tmp,
  `${JSON.stringify({ appPath, version, builtAt }, null, 2)}\n`,
);
fs.renameSync(tmp, out);
console.log(
  `[airlock] dev-update manifest -> ${out}\n  appPath=${appPath}\n  version=${version} builtAt=${builtAt}`,
);
