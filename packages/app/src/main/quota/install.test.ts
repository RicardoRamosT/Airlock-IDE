import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, expect, it } from "vitest";
import {
  buildStatusLineCommand,
  installQuotaStatusLine,
  isQuotaInstalled,
  type QuotaPaths,
  uninstallQuotaStatusLine,
} from "./install";

let paths: QuotaPaths;

beforeEach(async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "quota-install-"));
  paths = {
    settingsPath: path.join(dir, "settings.json"),
    bookkeepingPath: path.join(dir, "install.json"),
    emitConfigPath: path.join(dir, "emit-config.sh"),
    outPath: path.join(dir, "rate-limits.json"),
    emitScript: "/fake/Resources/statusline-emit.sh",
  };
});

const readJson = async (f: string) => JSON.parse(await readFile(f, "utf8"));

it("builds a PURE-SHELL command (no node) that runs the emitter via /bin/sh", () => {
  const cmd = buildStatusLineCommand(paths);
  expect(cmd).toContain("/bin/sh");
  expect(cmd).toContain("statusline-emit.sh");
  expect(cmd).toContain(paths.emitConfigPath);
  // The whole point of the fix: NO node / Electron-as-node, which crashes at
  // bootstrap under Claude Code's statusLine spawn.
  expect(cmd).not.toContain("ELECTRON_RUN_AS_NODE");
  expect(cmd).not.toContain("env -i");
});

it("single-quotes the emitter + config paths so shell metacharacters cannot break the command", () => {
  const cmd = buildStatusLineCommand({
    ...paths,
    emitScript: "/Users/na$me/My App/statusline-emit.sh",
  });
  // The whole path is wrapped in single quotes -> the $ is literal, not expanded.
  expect(cmd).toContain("'/Users/na$me/My App/statusline-emit.sh'");
});

it("installs into an empty settings dir with a shell-sourceable config (prior empty)", async () => {
  await installQuotaStatusLine(paths);
  const settings = await readJson(paths.settingsPath);
  expect(settings.statusLine.command).toContain("statusline-emit.sh");
  // refreshInterval keeps the meter live while a session is idle.
  expect(settings.statusLine.refreshInterval).toBeGreaterThan(0);
  // emit-config is now a shell-sourceable file (OUT=..., PRIOR=...), read by the
  // shell emitter -- NOT JSON.
  const cfg = await readFile(paths.emitConfigPath, "utf8");
  expect(cfg).toContain(`OUT='${paths.outPath}'`);
  expect(cfg).toMatch(/PRIOR=''/); // no prior -> empty
  expect((await readJson(paths.bookkeepingPath)).installed).toBe(true);
});

it("captures a pre-existing user statusLine and chains it via the shell config", async () => {
  const prior = { type: "command", command: "my-statusline.sh" };
  await writeFile(paths.settingsPath, JSON.stringify({ statusLine: prior }));
  await installQuotaStatusLine(paths);
  const cfg = await readFile(paths.emitConfigPath, "utf8");
  expect(cfg).toContain("PRIOR='my-statusline.sh'");
  expect((await readJson(paths.settingsPath)).statusLine.command).toContain(
    "statusline-emit.sh",
  );
  // Bookkeeping still stores the full prior object (for uninstall restoration).
  expect((await readJson(paths.bookkeepingPath)).prior).toEqual(prior);
});

it("recognizes a LEGACY node (.cjs) statusLine as ours and replaces it (not chains it)", async () => {
  // An older install wrote a statusline-emit.cjs command. On upgrade we must
  // treat it as ours and replace it, never capture it as the user's prior.
  const legacy = {
    type: "command",
    command:
      "ELECTRON_RUN_AS_NODE=1 '/x/AirLock' '/x/statusline-emit.cjs' '/x/emit-config.json'",
  };
  await writeFile(paths.settingsPath, JSON.stringify({ statusLine: legacy }));
  await installQuotaStatusLine(paths);
  const cfg = await readFile(paths.emitConfigPath, "utf8");
  expect(cfg).toMatch(/PRIOR=''/); // legacy not captured as prior
  expect((await readJson(paths.bookkeepingPath)).prior ?? null).toBeNull();
});

it("is idempotent: re-install never loses the original prior", async () => {
  const prior = { type: "command", command: "my-statusline.sh" };
  await writeFile(paths.settingsPath, JSON.stringify({ statusLine: prior }));
  await installQuotaStatusLine(paths);
  await installQuotaStatusLine(paths); // re-run; statusLine is now ours
  expect((await readJson(paths.bookkeepingPath)).prior).toEqual(prior);
  expect(await readFile(paths.emitConfigPath, "utf8")).toContain(
    "PRIOR='my-statusline.sh'",
  );
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

it("isQuotaInstalled tracks the install/uninstall lifecycle", async () => {
  expect(await isQuotaInstalled(paths)).toBe(false); // never installed
  await installQuotaStatusLine(paths);
  expect(await isQuotaInstalled(paths)).toBe(true);
  await uninstallQuotaStatusLine(paths);
  expect(await isQuotaInstalled(paths)).toBe(false);
});
