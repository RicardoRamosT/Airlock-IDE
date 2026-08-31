import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  isLicenseDocKind,
  LICENSE_DOC_KINDS,
  licenseDocPath,
} from "./licenseDocs";

const PACKAGED = {
  packaged: true,
  resourcesDir: "/Apps/AirLock.app/Contents/Resources",
  repoRoot: "/repo",
};
const DEV = { packaged: false, resourcesDir: "/ignored", repoRoot: "/repo" };

describe("licenseDocPath", () => {
  it("resolves our own licence under Resources when packaged", () => {
    expect(licenseDocPath("license", PACKAGED)).toBe(
      "/Apps/AirLock.app/Contents/Resources/LICENSE.md",
    );
    expect(licenseDocPath("commercial", PACKAGED)).toBe(
      "/Apps/AirLock.app/Contents/Resources/COMMERCIAL.md",
    );
  });

  it("resolves the third-party notices under Resources/third-party", () => {
    // Chromium's BSD-3 wants its notice shipped WITH the distribution, so these
    // have to come out of the bundle, not off the network.
    expect(licenseDocPath("chromium", PACKAGED)).toBe(
      "/Apps/AirLock.app/Contents/Resources/third-party/LICENSES.chromium.html",
    );
    expect(licenseDocPath("electron", PACKAGED)).toBe(
      "/Apps/AirLock.app/Contents/Resources/third-party/electron-LICENSE.txt",
    );
  });

  it("reads from the repo in a dev checkout, where nothing has been staged", () => {
    expect(licenseDocPath("license", DEV)).toBe("/repo/LICENSE.md");
    expect(licenseDocPath("chromium", DEV)).toBe(
      path.join("/repo", "node_modules/electron/dist/LICENSES.chromium.html"),
    );
  });

  it("returns null for an unknown kind instead of building a path", () => {
    // The renderer names a document, never a path. A bad argument must be a
    // no-op, not an opportunity to open an arbitrary file.
    expect(licenseDocPath("../../../etc/passwd", PACKAGED)).toBeNull();
    expect(licenseDocPath("", PACKAGED)).toBeNull();
    expect(licenseDocPath(undefined, PACKAGED)).toBeNull();
    expect(licenseDocPath({ kind: "license" }, PACKAGED)).toBeNull();
  });

  it("cannot be talked out of the resources directory by any allowed kind", () => {
    // The guard above is only as good as the table it protects, so assert the
    // property on every kind rather than trusting the four literals.
    for (const kind of LICENSE_DOC_KINDS) {
      const p = licenseDocPath(kind, PACKAGED) as string;
      expect(path.normalize(p).startsWith(PACKAGED.resourcesDir)).toBe(true);
      expect(p).not.toContain("..");
    }
  });

  it("exposes exactly the four documents the About tab offers", () => {
    expect([...LICENSE_DOC_KINDS].sort()).toEqual([
      "chromium",
      "commercial",
      "electron",
      "license",
    ]);
  });

  it("isLicenseDocKind accepts only those four", () => {
    expect(isLicenseDocKind("license")).toBe(true);
    expect(isLicenseDocKind("toString")).toBe(false); // not an inherited key
    expect(isLicenseDocKind(null)).toBe(false);
  });
});
