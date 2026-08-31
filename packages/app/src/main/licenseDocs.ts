// ASCII comments only. Where the licence documents live, in the packaged app
// and in a dev checkout.
//
// WHY THIS EXISTS. AirLock is dual-licensed: noncommercial use is free under
// PolyForm Strict, and commercial use needs a separate agreement. Until 0.7.1
// none of that shipped -- LICENSE.md was in the repo and nowhere in the DMG, so
// someone who installed the app had no copy of the terms they had accepted and
// no way to discover that a commercial licence exists. PolyForm's Acceptance
// clause makes agreement a condition of every grant, which is hard to square
// with never showing anyone the text.
//
// Electron and Chromium are the other half. Chromium's BSD-3 requires its
// notice be reproduced "in the documentation and/or other materials provided
// with the distribution", and electron-builder does not copy them into a macOS
// bundle by default (on macOS they sit BESIDE Electron.app in the dist folder,
// not inside it), so they were absent too. The 144 npm dependency LICENSE files
// were already fine: they ride along inside app.asar with their packages.
//
// The resolver is an ALLOW-LIST, not a path join. The renderer names a document
// by kind and never supplies a path, so this can never be talked into opening
// an arbitrary file.

import path from "node:path";
import type { LicenseDocKind } from "../shared/ipc";

// Where each document sits under the resources directory. The two third-party
// notices are copied there by electron-builder's extraResources; our own two
// are copied from the repo root.
const DOC_RELATIVE: Record<LicenseDocKind, string> = {
  license: "LICENSE.md",
  commercial: "COMMERCIAL.md",
  electron: path.join("third-party", "electron-LICENSE.txt"),
  chromium: path.join("third-party", "LICENSES.chromium.html"),
};

export const LICENSE_DOC_KINDS = Object.keys(DOC_RELATIVE) as LicenseDocKind[];

// Object.hasOwn, NOT `in`: `in` walks the prototype chain, so "toString" and
// "constructor" would both answer true and resolve to an undefined path entry.
export function isLicenseDocKind(v: unknown): v is LicenseDocKind {
  return typeof v === "string" && Object.hasOwn(DOC_RELATIVE, v);
}

// `resourcesDir` is process.resourcesPath when packaged. In a dev checkout the
// files have not been staged anywhere, so they are read from the repo instead:
// our two from the root, Electron's two from its own package. Returns null for
// an unknown kind rather than throwing, so a bad IPC argument is a no-op.
export function licenseDocPath(
  kind: unknown,
  opts: { packaged: boolean; resourcesDir: string; repoRoot: string },
): string | null {
  if (!isLicenseDocKind(kind)) return null;
  if (opts.packaged) return path.join(opts.resourcesDir, DOC_RELATIVE[kind]);
  const devSource: Record<LicenseDocKind, string> = {
    license: "LICENSE.md",
    commercial: "COMMERCIAL.md",
    electron: path.join("node_modules", "electron", "dist", "LICENSE"),
    chromium: path.join(
      "node_modules",
      "electron",
      "dist",
      "LICENSES.chromium.html",
    ),
  };
  return path.join(opts.repoRoot, devSource[kind]);
}
