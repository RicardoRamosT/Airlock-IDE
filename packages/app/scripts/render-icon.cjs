// Renders build/icon.svg -> build/icon.png at 1024x1024 with alpha.
// Run via: npx electron packages/app/scripts/render-icon.cjs   (from repo root)
// Note: using .cjs (CommonJS) because ESM electron import via .mjs can error
// when npx electron runs the script directly.
const { readFileSync, writeFileSync } = require("node:fs");
const path = require("node:path");
const { BrowserWindow, app } = require("electron");

const dir = path.dirname(__filename);
const svg = readFileSync(path.join(dir, "../build/icon.svg"), "utf8");
const html = `<!doctype html><html><body style="margin:0;background:transparent">${svg}</body></html>`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: 1024,
    height: 1024,
    transparent: true,
    frame: false,
    backgroundColor: "#00000000",
    webPreferences: { offscreen: true },
  });
  await win.loadURL(
    `data:text/html;base64,${Buffer.from(html).toString("base64")}`,
  );
  await new Promise((r) => setTimeout(r, 500)); // let it paint
  const image = await win.webContents.capturePage();
  writeFileSync(path.join(dir, "../build/icon.png"), image.toPNG());
  console.log("icon.png written");
  app.quit();
});
