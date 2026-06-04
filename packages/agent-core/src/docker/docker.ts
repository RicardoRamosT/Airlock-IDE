import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

export interface Container {
  id: string;
  name: string;
  image: string;
  state: string; // running | exited | created | paused | ...
  status: string; // human string, e.g. "Up 3 hours"
}

export type DockerRunner = (args: string[]) => Promise<string>;

const realDocker: DockerRunner = async (args) => {
  const { stdout } = await exec("docker", args, { maxBuffer: 8 * 1024 * 1024 });
  return stdout;
};

/**
 * Parse `docker ps -a --format '{{json .}}'` -- one JSON object per line.
 * Robust to extra fields; tolerant of blank lines and unparseable lines.
 */
export function parseDockerPs(raw: string): Container[] {
  const out: Container[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    let o: Record<string, unknown>;
    try {
      o = JSON.parse(t) as Record<string, unknown>;
    } catch {
      continue;
    }
    out.push({
      id: String(o.ID ?? ""),
      name: String(o.Names ?? ""),
      image: String(o.Image ?? ""),
      state: String(o.State ?? "").toLowerCase(),
      status: String(o.Status ?? ""),
    });
  }
  return out;
}

export interface DockerStatus {
  installed: boolean;
  running: boolean; // daemon reachable
  containers: Container[];
}

export async function dockerContainers(
  run: DockerRunner = realDocker,
): Promise<DockerStatus> {
  try {
    const out = await run(["ps", "-a", "--format", "{{json .}}"]);
    return { installed: true, running: true, containers: parseDockerPs(out) };
  } catch (err) {
    const e = err as { code?: string; stderr?: string };
    if (e.code === "ENOENT")
      return { installed: false, running: false, containers: [] };
    // docker present but daemon down (or other error) -> installed, not running.
    return { installed: true, running: false, containers: [] };
  }
}

function assertId(id: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(id))
    throw new Error("Invalid container id");
}

export async function dockerStart(
  id: string,
  run: DockerRunner = realDocker,
): Promise<void> {
  assertId(id);
  await run(["start", id]);
}

export async function dockerStop(
  id: string,
  run: DockerRunner = realDocker,
): Promise<void> {
  assertId(id);
  await run(["stop", id]);
}
