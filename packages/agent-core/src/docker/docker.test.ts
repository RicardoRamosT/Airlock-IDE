import { describe, expect, it } from "vitest";
import {
  type Container,
  containerBelongsTo,
  databaseContainers,
  dockerStop,
  parseDockerLabels,
  parseDockerPs,
  scopeContainersToRoot,
} from "./docker";

describe("parseDockerPs", () => {
  it("parses json-per-line into containers", () => {
    const raw = [
      JSON.stringify({
        ID: "f58b7c4201af",
        Names: "seq",
        Image: "datalust/seq:latest",
        State: "running",
        Status: "Up 3 hours",
      }),
      JSON.stringify({
        ID: "abc123",
        Names: "pg",
        Image: "postgres:16",
        State: "exited",
        Status: "Exited (0) 2 days ago",
      }),
    ].join("\n");
    expect(parseDockerPs(raw)).toEqual([
      {
        id: "f58b7c4201af",
        name: "seq",
        image: "datalust/seq:latest",
        state: "running",
        status: "Up 3 hours",
        ports: "",
        project: null,
        projectDir: null,
      },
      {
        id: "abc123",
        name: "pg",
        image: "postgres:16",
        state: "exited",
        status: "Exited (0) 2 days ago",
        ports: "",
        project: null,
        projectDir: null,
      },
    ]);
  });

  it("skips blank and unparseable lines", () => {
    expect(
      parseDockerPs(
        "\n{bad json\n" +
          JSON.stringify({
            ID: "x",
            Names: "n",
            Image: "i",
            State: "running",
            Status: "Up",
          }),
      ),
    ).toEqual([
      {
        id: "x",
        name: "n",
        image: "i",
        state: "running",
        status: "Up",
        ports: "",
        project: null,
        projectDir: null,
      },
    ]);
  });

  it("returns [] for empty output", () => {
    expect(parseDockerPs("")).toEqual([]);
  });

  it("rejects injected container ids and runs correct argv otherwise", async () => {
    await expect(dockerStop("; rm -rf", async () => "")).rejects.toThrow(
      /invalid/i,
    );
    let captured: string[] = [];
    await dockerStop("f58b7c4201af", async (args) => {
      captured = args;
      return "";
    });
    expect(captured).toEqual(["stop", "f58b7c4201af"]);
  });
});

// Docker is not a database -- it is a place databases live. Databases shows the
// CONTAINERS it found, not a row called "Docker".
describe("databaseContainers", () => {
  const c = (image: string, ports = ""): Container => ({
    id: `id-${image}`,
    name: `n-${image}`,
    image,
    state: "running",
    status: "Up 3 hours",
    ports,
    project: null,
    projectDir: null,
  });

  it("matches a known engine regardless of tag or registry prefix", () => {
    const got = databaseContainers([
      c("postgres:16", "0.0.0.0:5432->5432/tcp"),
      c("docker.io/library/mysql:8", "0.0.0.0:3306->3306/tcp"),
      c("redis", "6379/tcp"),
    ]);
    expect(got.map((d) => d.engine)).toEqual(["postgres", "mysql", "redis"]);
  });

  it("reads the published HOST port, not the container port", () => {
    // 15432 on the host maps to 5432 inside; connecting needs the host side.
    const [d] = databaseContainers([
      c("postgres:16", "0.0.0.0:15432->5432/tcp"),
    ]);
    expect(d?.hostPort).toBe(15432);
  });

  it("reports no host port when nothing is published", () => {
    // Reachable only from inside the docker network -- honest null beats a
    // guess that fails at connect time.
    const [d] = databaseContainers([c("postgres:16", "5432/tcp")]);
    expect(d?.hostPort).toBeNull();
  });

  it("ignores containers that are not databases", () => {
    expect(databaseContainers([c("nginx:alpine"), c("my-app")])).toEqual([]);
  });

  it("does not match an engine name embedded in an unrelated image", () => {
    // "my-postgres-backup-tool" is not a Postgres server.
    expect(databaseContainers([c("acme/my-postgres-backup-tool:1")])).toEqual(
      [],
    );
  });

  it("degrades to an empty list for a malformed ports string", () => {
    const [d] = databaseContainers([c("postgres:16", "nonsense")]);
    expect(d?.hostPort).toBeNull();
  });
});

// A container shaped like `docker ps` gives it, with only the fields a test
// cares about spelled out.
function container(over: Partial<Container> = {}): Container {
  return {
    id: "c1",
    name: "n",
    image: "postgres:16",
    state: "running",
    status: "Up",
    ports: "",
    project: null,
    projectDir: null,
    ...over,
  };
}

describe("parseDockerLabels", () => {
  it("parses plain key=value pairs", () => {
    expect(parseDockerLabels("a=1,b=2")).toEqual({ a: "1", b: "2" });
  });

  it("keeps a value that itself contains commas", () => {
    // compose writes every compose file into one label, comma separated. A
    // naive split truncates it at the first file AND, because the project
    // labels follow it, used to swallow them entirely.
    const raw =
      "com.docker.compose.project.config_files=/p/a.yml,/p/b.yml," +
      "com.docker.compose.project=demo," +
      "com.docker.compose.project.working_dir=/p";
    expect(parseDockerLabels(raw)).toMatchObject({
      "com.docker.compose.project.config_files": "/p/a.yml,/p/b.yml",
      "com.docker.compose.project": "demo",
      "com.docker.compose.project.working_dir": "/p",
    });
  });

  it("keeps an empty value and tolerates no labels at all", () => {
    expect(parseDockerLabels("com.docker.compose.depends_on=")).toEqual({
      "com.docker.compose.depends_on": "",
    });
    expect(parseDockerLabels("")).toEqual({});
  });
});

describe("parseDockerPs owner labels", () => {
  it("reads the owning project and directory off the labels", () => {
    const raw = JSON.stringify({
      ID: "abc",
      Names: "trackview-postgres-1",
      Image: "postgres:17",
      State: "running",
      Status: "Up 26 hours",
      Labels:
        "com.docker.compose.container-number=1," +
        "com.docker.compose.project.config_files=/Users/r/Projects/Trackview/docker-compose.yml," +
        "com.docker.compose.project=trackview," +
        "com.docker.compose.project.working_dir=/Users/r/Projects/Trackview",
    });
    expect(parseDockerPs(raw)[0]).toMatchObject({
      project: "trackview",
      projectDir: "/Users/r/Projects/Trackview",
    });
  });

  it("leaves a non-compose container unattributed rather than guessing", () => {
    const raw = JSON.stringify({ ID: "x", Names: "loose", Image: "redis" });
    expect(parseDockerPs(raw)[0]).toMatchObject({
      project: null,
      projectDir: null,
    });
  });
});

describe("containerBelongsTo", () => {
  const root = "/Users/r/Projects/app";

  it("claims the project directory and anything under it", () => {
    expect(containerBelongsTo(container({ projectDir: root }), root)).toBe(
      true,
    );
    expect(
      containerBelongsTo(container({ projectDir: `${root}/infra` }), root),
    ).toBe(true);
  });

  it("ignores a trailing slash on either side", () => {
    expect(
      containerBelongsTo(container({ projectDir: `${root}/` }), root),
    ).toBe(true);
    expect(
      containerBelongsTo(container({ projectDir: root }), `${root}/`),
    ).toBe(true);
  });

  it("does not claim a sibling that merely shares a prefix", () => {
    // The real shape: lendlogic-baapp's containers live in a WORKTREE beside
    // the project, not beneath it. Conservative is correct here -- they are
    // still reported, under otherProjects, with their directory visible.
    expect(
      containerBelongsTo(
        container({ projectDir: `${root}-worktrees/x` }),
        root,
      ),
    ).toBe(false);
  });

  it("does not claim a parent directory (a monorepo sibling is not this project)", () => {
    expect(
      containerBelongsTo(container({ projectDir: "/Users/r/Projects" }), root),
    ).toBe(false);
  });

  it("claims nothing when unattributable or when no project is focused", () => {
    expect(containerBelongsTo(container(), root)).toBe(false);
    expect(containerBelongsTo(container({ projectDir: root }), null)).toBe(
      false,
    );
  });
});

describe("scopeContainersToRoot", () => {
  it("hands a project with no containers of its own an EMPTY list, not the machine's", () => {
    // The observed regression: airlock has no Dockerfile and no compose file,
    // and was shown five containers owned by four other projects, flat and
    // unlabelled. An agent then queried one of them and reported on it as if
    // it were this project's.
    const machine = [
      container({ id: "1", project: "mainlogic", projectDir: "/p/mainlogic" }),
      container({ id: "2", project: "trackview", projectDir: "/p/Trackview" }),
      container({ id: "3", project: "helm", projectDir: "/p/helm" }),
      container({ id: "4", project: "intake", projectDir: "/p/.wt/intake" }),
      container({ id: "5", project: "intake", projectDir: "/p/.wt/intake" }),
    ];
    const got = scopeContainersToRoot(machine, "/p/airlock");
    expect(got.containers).toEqual([]);
    // Nothing is hidden: every owner is still named, with a count.
    expect(got.otherProjects).toEqual([
      { project: "mainlogic", projectDir: "/p/mainlogic", containers: 1 },
      { project: "trackview", projectDir: "/p/Trackview", containers: 1 },
      { project: "helm", projectDir: "/p/helm", containers: 1 },
      { project: "intake", projectDir: "/p/.wt/intake", containers: 2 },
    ]);
  });

  it("returns this project's containers and counts only the rest", () => {
    const got = scopeContainersToRoot(
      [
        container({ id: "mine", project: "app", projectDir: "/p/app" }),
        container({ id: "theirs", project: "other", projectDir: "/p/other" }),
      ],
      "/p/app",
    );
    expect(got.containers.map((c) => c.id)).toEqual(["mine"]);
    expect(got.otherProjects).toEqual([
      { project: "other", projectDir: "/p/other", containers: 1 },
    ]);
  });

  it("groups unattributable containers rather than dropping them", () => {
    // A `docker run` postgres is still running on the machine; silently
    // hiding it trades one wrong answer for another.
    const got = scopeContainersToRoot(
      [container({ id: "a" }), container({ id: "b" })],
      "/p/app",
    );
    expect(got.containers).toEqual([]);
    expect(got.otherProjects).toEqual([
      { project: null, projectDir: null, containers: 2 },
    ]);
  });

  it("claims nothing when no project is focused", () => {
    const got = scopeContainersToRoot(
      [container({ project: "app", projectDir: "/p/app" })],
      null,
    );
    expect(got.containers).toEqual([]);
    expect(got.otherProjects).toHaveLength(1);
  });
});
