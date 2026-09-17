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
  // WHO OWNS THIS CONTAINER. Compose stamps both on every container it starts,
  // and `docker ps --format '{{json .}}'` already returns them in `Labels` --
  // so attributing a container costs no extra `docker inspect`.
  //
  // Without these the container list is machine-global and anonymous, which is
  // how a project with no Dockerfile at all was shown five containers owned by
  // four other projects, with nothing marking them foreign.
  //
  // null when the container was NOT started by compose (a bare `docker run`
  // records no owner). Null, never a guess: mis-attributing a container to the
  // project someone is working in is the exact failure this field exists to
  // stop.
  project: string | null; // com.docker.compose.project
  projectDir: string | null; // com.docker.compose.project.working_dir
}

export type DockerRunner = (args: string[]) => Promise<string>;

// maxBuffer was set and `timeout` was not, which is the wrong half: a bounded
// buffer stops a chatty command, a deadline stops a WEDGED one. `docker` talks
// to a daemon over a socket and hangs indefinitely when that daemon is
// unhealthy -- and the extensions surfaces poll it, so one sick daemon meant an
// unbounded pile of stuck children and never-settling promises.
const DOCKER_TIMEOUT_MS = 10_000;

const realDocker: DockerRunner = async (args) => {
  const { stdout } = await exec("docker", args, {
    maxBuffer: 8 * 1024 * 1024,
    timeout: DOCKER_TIMEOUT_MS,
    killSignal: "SIGKILL",
  });
  return stdout;
};

/**
 * Parse Docker's flat `Labels` rendering ("k=v,k=v,...") into a map.
 *
 * A VALUE may itself contain commas -- compose writes
 * `com.docker.compose.project.config_files=/a/compose.yml,/b/compose.yml` --
 * so splitting on every comma truncates such a value at its first one. A
 * fragment carrying no "=" is therefore a CONTINUATION of the previous value,
 * not a new label.
 *
 * A continuation that happens to contain "=" is still read as a new key, which
 * can leave a junk entry in the map. That is deliberate: the alternative is
 * guessing where a value ends, and the two keys we read (project,
 * project.working_dir) are a name and a path, neither of which contains a
 * comma.
 */
export function parseDockerLabels(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  let key = "";
  for (const frag of raw.split(",")) {
    const eq = frag.indexOf("=");
    if (eq > 0) {
      key = frag.slice(0, eq);
      out[key] = frag.slice(eq + 1);
    } else if (key) {
      out[key] += `,${frag}`;
    }
  }
  return out;
}

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
    const labels = parseDockerLabels(String(o.Labels ?? ""));
    out.push({
      id: String(o.ID ?? ""),
      name: String(o.Names ?? ""),
      image: String(o.Image ?? ""),
      state: String(o.State ?? "").toLowerCase(),
      status: String(o.Status ?? ""),
      ports: String(o.Ports ?? ""),
      project: labels["com.docker.compose.project"] || null,
      projectDir: labels["com.docker.compose.project.working_dir"] || null,
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

// A trailing slash is not a different directory. Compare paths without one so
// "/p/app" and "/p/app/" are the same project.
function trimSlash(p: string): string {
  return p.length > 1 && p.endsWith("/") ? p.replace(/\/+$/, "") : p;
}

/**
 * Whether a container belongs to the project rooted at `root`.
 *
 * True for the project directory itself and anything under it (a compose file
 * in a subfolder still belongs to the project). Deliberately NOT true when the
 * container's directory merely CONTAINS the root: a monorepo sibling is not
 * this project, and claiming it would reintroduce the confusion.
 *
 * An unattributable container (no compose labels) is never claimed, and with no
 * project focused nothing is this project's.
 */
export function containerBelongsTo(c: Container, root: string | null): boolean {
  if (!root || !c.projectDir) return false;
  const dir = trimSlash(c.projectDir);
  const r = trimSlash(root);
  return dir === r || dir.startsWith(`${r}/`);
}

// One other project's containers, summarised. A COUNT and an owner, never the
// containers themselves: the point is that a foreign container cannot be read
// as this project's, and a name/image/port for each is exactly what made that
// mistake possible.
export interface ForeignContainers {
  project: string | null;
  projectDir: string | null;
  containers: number;
}

export interface ScopedContainers {
  // Only the focused project's containers.
  containers: Container[];
  // Every other owner, with a count. Empty when nothing else is running.
  otherProjects: ForeignContainers[];
}

/**
 * Split a machine-global container list into "this project's" and "everyone
 * else's, counted".
 *
 * Containers with no compose labels cannot be attributed to anyone, so they are
 * grouped under a null owner rather than being dropped -- a `docker run`
 * postgres is still a real thing running on the machine, and silently hiding it
 * would trade one wrong answer for another.
 *
 * Order is first-seen, so the output is stable for a stable `docker ps`.
 */
export function scopeContainersToRoot(
  containers: Container[],
  root: string | null,
): ScopedContainers {
  const mine: Container[] = [];
  const others = new Map<string, ForeignContainers>();
  for (const c of containers) {
    if (containerBelongsTo(c, root)) {
      mine.push(c);
      continue;
    }
    const key = c.projectDir ?? c.project ?? "";
    const seen = others.get(key);
    if (seen) seen.containers += 1;
    else
      others.set(key, {
        project: c.project,
        projectDir: c.projectDir,
        containers: 1,
      });
  }
  return { containers: mine, otherProjects: [...others.values()] };
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

/**
 * A container's environment, from `docker inspect`. Used to discover Postgres
 * credentials so the Docker section can list databases and tables (see
 * ./pgUrl). Returns [] for an unknown container or unparseable output rather
 * than throwing -- the caller degrades to "no credentials", which is a state
 * the UI already renders honestly.
 *
 * The values include a PASSWORD, so this must only ever be called in main and
 * its result must never cross IPC.
 */
export async function dockerEnv(
  id: string,
  run: DockerRunner = realDocker,
): Promise<string[]> {
  try {
    const out = await run(["inspect", "--format", "{{json .Config.Env}}", id]);
    const parsed: unknown = JSON.parse(out.trim() || "null");
    return Array.isArray(parsed)
      ? parsed.filter((x) => typeof x === "string")
      : [];
  } catch {
    return [];
  }
}
