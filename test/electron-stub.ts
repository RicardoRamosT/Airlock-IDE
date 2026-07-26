// Test-only stand-in for the `electron` module, wired in via vitest.config.ts.
//
// WHY: several main-process modules do `import { BrowserWindow } from "electron"` at
// module scope, so importing them in a unit test loads the electron package. Under
// plain Node that package does NOT export Electron's APIs -- it resolves to the
// STRING path of the Electron binary, and it THROWS ("Electron failed to install
// correctly") when that binary is missing. CI has no reason to download ~100MB of
// Electron just so an import can succeed; the first CI run failed exactly there.
//
// EVERY MEMBER IS `undefined` ON PURPOSE. That is precisely what destructuring the
// real module's string gives you, so this changes nothing about how the suite
// behaves -- it only removes the dependency on the binary being present. Do not
// "improve" these into working fakes: main-process code branches on whether Electron
// is there (e.g. resources.ts does `app?.isPackaged ? packagedPath : devPath`), so a
// truthy stub silently flips such code onto its packaged path and breaks the test in
// a confusing way. Learned the hard way -- a Proxy returning no-op functions made
// `app.isPackaged` truthy and blew up path.join with an undefined resourcesPath.
//
// Anything that genuinely needs Electron behaviour is tested through an injected
// seam instead (see ToolDeps, changeVisibility, the tabdrag pure modules).

export const app = undefined;
export const ipcMain = undefined;
export const ipcRenderer = undefined;
export const contextBridge = undefined;
export const shell = undefined;
export const screen = undefined;
export const clipboard = undefined;
export const dialog = undefined;
export const nativeImage = undefined;
export const webUtils = undefined;
export const Menu = undefined;
export const BrowserWindow = undefined;

export default undefined;
