import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

// Curated registry of macOS terminal apps AirLock can launch. Each entry knows
// its bundle id (for detection) and how to open a directory (commands differ
// per terminal). ASCII-only (CJS-bundled into the Electron main).
export interface ExternalTerminal {
  id: string;
  name: string;
  bundleId: string;
  // Build the execFile(cmd, args) that opens `dir` in this terminal.
  launch: (dir: string) => { cmd: string; args: string[] };
}

const openA =
  (app: string) =>
  (dir: string): { cmd: string; args: string[] } => ({
    cmd: "open",
    args: ["-a", app, dir],
  });

export const KNOWN_TERMINALS: ExternalTerminal[] = [
  {
    id: "terminal",
    name: "Terminal",
    bundleId: "com.apple.Terminal",
    launch: openA("Terminal"),
  },
  {
    id: "iterm2",
    name: "iTerm",
    bundleId: "com.googlecode.iterm2",
    launch: openA("iTerm"),
  },
  {
    id: "ghostty",
    name: "Ghostty",
    bundleId: "com.mitchellh.ghostty",
    launch: openA("Ghostty"),
  },
  {
    id: "warp",
    name: "Warp",
    bundleId: "dev.warp.Warp-Stable",
    launch: openA("Warp"),
  },
  {
    id: "alacritty",
    name: "Alacritty",
    bundleId: "org.alacritty",
    launch: (dir) => ({
      cmd: "open",
      args: ["-a", "Alacritty", "--args", "--working-directory", dir],
    }),
  },
  {
    id: "kitty",
    name: "kitty",
    bundleId: "net.kovidgoyal.kitty",
    launch: (dir) => ({
      cmd: "open",
      args: ["-a", "kitty", "--args", "--directory", dir],
    }),
  },
  {
    id: "wezterm",
    name: "WezTerm",
    bundleId: "com.github.wez.wezterm",
    launch: (dir) => ({
      cmd: "open",
      args: ["-a", "WezTerm", "--args", "start", "--cwd", dir],
    }),
  },
];

const byId = new Map(KNOWN_TERMINALS.map((t) => [t.id, t]));

// Pure: the launch argv for a terminal id + dir, or null if the id is unknown.
export function launchArgs(
  id: string,
  dir: string,
): { cmd: string; args: string[] } | null {
  return byId.get(id)?.launch(dir) ?? null;
}

// Pure: a terminal id's display name, falling back to the id itself.
export function terminalDisplayName(id: string): string {
  return byId.get(id)?.name ?? id;
}

// Pure: given each terminal's mdfind stdout (a path or ""), the installed
// subset. Terminal.app ships with macOS, so it is always treated as installed.
export function parseInstalled(
  results: Record<string, string>,
): { id: string; name: string }[] {
  return KNOWN_TERMINALS.filter(
    (t) => t.id === "terminal" || (results[t.id] ?? "").trim().length > 0,
  ).map((t) => ({ id: t.id, name: t.name }));
}

// DI-able mdfind runner (mirrors docker.ts's DockerRunner). Real one shells out.
export type MdfindRunner = (args: string[]) => Promise<string>;
const realMdfind: MdfindRunner = async (args) => {
  const { stdout } = await exec("mdfind", args, { maxBuffer: 1 * 1024 * 1024 });
  return stdout;
};

// Which known terminals are installed: one mdfind-by-bundle-id per terminal.
export async function detectInstalledTerminals(
  run: MdfindRunner = realMdfind,
): Promise<{ id: string; name: string }[]> {
  const results: Record<string, string> = {};
  await Promise.all(
    KNOWN_TERMINALS.map(async (t) => {
      try {
        results[t.id] = await run([
          `kMDItemCFBundleIdentifier == '${t.bundleId}'`,
        ]);
      } catch {
        results[t.id] = "";
      }
    }),
  );
  return parseInstalled(results);
}
