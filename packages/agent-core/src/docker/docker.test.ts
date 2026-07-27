import { describe, expect, it } from "vitest";
import {
  type Container,
  databaseContainers,
  dockerStop,
  parseDockerPs,
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
      },
      {
        id: "abc123",
        name: "pg",
        image: "postgres:16",
        state: "exited",
        status: "Exited (0) 2 days ago",
        ports: "",
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
