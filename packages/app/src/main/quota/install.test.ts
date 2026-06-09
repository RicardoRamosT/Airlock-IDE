import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, expect, it } from "vitest";
import {
  buildStatusLineCommand,
  installQuotaStatusLine,
  type QuotaPaths,
  uninstallQuotaStatusLine,
} from "./install";

let paths: QuotaPaths;

beforeEach(async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "quota-install-"));
  paths = {
    settingsPath: path.join(dir, "settings.json"),
    bookkeepingPath: path.join(dir, "install.json"),
    emitConfigPath: path.join(dir, "emit-config.json"),
    outPath: path.join(dir, "rate-limits.json"),
    execPath: "/fake/Electron",
    emitScript: "/fake/Resources/statusline-emit.cjs",
  };
});

const readJson = async (f: string) => JSON.parse(await readFile(f, "utf8"));

it("builds a command that runs Electron-as-node against the emitter", () => {
  const cmd = buildStatusLineCommand(paths);
  expect(cmd).toContain("ELECTRON_RUN_AS_NODE=1");
  expect(cmd).toContain('"/fake/Electron"');
  expect(cmd).toContain("statusline-emit.cjs");
  expect(cmd).toContain(paths.emitConfigPath);
});

it("installs into an empty settings dir with prior null", async () => {
  await installQuotaStatusLine(paths);
  const settings = await readJson(paths.settingsPath);
  expect(settings.statusLine.command).toContain("statusline-emit.cjs");
  expect(await readJson(paths.emitConfigPath)).toEqual({
    out: paths.outPath,
    prior: null,
  });
  expect((await readJson(paths.bookkeepingPath)).installed).toBe(true);
});

it("captures and chains a pre-existing user statusLine", async () => {
  const prior = { type: "command", command: "my-statusline.sh" };
  await writeFile(paths.settingsPath, JSON.stringify({ statusLine: prior }));
  await installQuotaStatusLine(paths);
  expect((await readJson(paths.emitConfigPath)).prior).toEqual(prior);
  expect((await readJson(paths.settingsPath)).statusLine.command).toContain(
    "statusline-emit.cjs",
  );
});

it("is idempotent: re-install never loses the original prior", async () => {
  const prior = { type: "command", command: "my-statusline.sh" };
  await writeFile(paths.settingsPath, JSON.stringify({ statusLine: prior }));
  await installQuotaStatusLine(paths);
  await installQuotaStatusLine(paths); // re-run; statusLine is now ours
  expect((await readJson(paths.bookkeepingPath)).prior).toEqual(prior);
  expect((await readJson(paths.emitConfigPath)).prior).toEqual(prior);
});

it("uninstall restores the prior statusLine and clears bookkeeping", async () => {
  const prior = { type: "command", command: "my-statusline.sh" };
  await writeFile(paths.settingsPath, JSON.stringify({ statusLine: prior }));
  await installQuotaStatusLine(paths);
  await uninstallQuotaStatusLine(paths);
  expect((await readJson(paths.settingsPath)).statusLine).toEqual(prior);
  expect((await readJson(paths.bookkeepingPath)).installed).toBe(false);
});

it("uninstall removes statusLine entirely when there was no prior", async () => {
  await installQuotaStatusLine(paths);
  await uninstallQuotaStatusLine(paths);
  expect((await readJson(paths.settingsPath)).statusLine).toBeUndefined();
});

it("uninstall leaves a statusLine the user changed after install untouched", async () => {
  await installQuotaStatusLine(paths);
  const userSet = { type: "command", command: "user-changed.sh" };
  await writeFile(paths.settingsPath, JSON.stringify({ statusLine: userSet }));
  await uninstallQuotaStatusLine(paths);
  expect((await readJson(paths.settingsPath)).statusLine).toEqual(userSet);
});
