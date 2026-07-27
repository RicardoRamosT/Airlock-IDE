import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

export interface Container {
  id: string;
  name: string;
  image: string;
  state: string; // running | exited | created | paused | ...
  status: string; // human string, e.g. "Up 3 hours"
  // Docker's published-port string, e.g. "0.0.0.0:5432->5432/tcp". Already
  // present in `docker ps --format '{{json .}}'`; it used to be discarded.
  ports: string;
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
      ports: String(o.Ports ?? ""),
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

// The database engines AirLock recognises in an image name. Only `postgres` is
// connectable (the client is pg, via withDb/readRows); the rest are listed so
// the Docker section can show them, and so Databases can say "found, but not
// something I can query" rather than pretending they do not exist.
const ENGINES = ["postgres", "mysql", "mariadb", "mongo", "redis"] as const;
export type DbEngine = (typeof ENGINES)[number];

export interface DbContainer {
  id: string;
  name: string;
  image: string;
  engine: DbEngine;
  // Published host port, or null when the container publishes nothing (it is
  // reachable only inside the docker network). Null, never a guess: a wrong
  // port fails at connect time, which is worse than admitting we do not know.
  hostPort: number | null;
}

// The repository part of an image reference: strip a registry/namespace prefix
// and a tag or digest. "docker.io/library/mysql:8" -> "mysql".
function repoOf(image: string): string {
  const noDigest = image.split("@")[0] ?? "";
  const lastSegment = noDigest.split("/").pop() ?? "";
  return (lastSegment.split(":")[0] ?? "").toLowerCase();
}

// The FIRST published host port. Docker formats these as
// "0.0.0.0:15432->5432/tcp, :::15432->5432/tcp"; the number before "->" is the
// host side, which is the one you can actually connect to.
function hostPortOf(ports: string): number | null {
  const m = /:(\d+)->/.exec(ports);
  const n = m?.[1] ? Number(m[1]) : Number.NaN;
  return Number.isInteger(n) ? n : null;
}

export function databaseContainers(cs: Container[]): DbContainer[] {
  const out: DbContainer[] = [];
  for (const c of cs) {
    const repo = repoOf(c.image);
    // Exact repository match, not a substring: "my-postgres-backup-tool" is
    // not a Postgres server.
    const engine = ENGINES.find((e) => repo === e);
    if (!engine) continue;
    out.push({
      id: c.id,
      name: c.name,
      image: c.image,
      engine,
      hostPort: hostPortOf(c.ports),
    });
  }
  return out;
}
