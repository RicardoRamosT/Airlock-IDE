import { describe, expect, it } from "vitest";
import { dockerStop, parseDockerPs } from "./docker";

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
      },
      {
        id: "abc123",
        name: "pg",
        image: "postgres:16",
        state: "exited",
        status: "Exited (0) 2 days ago",
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
      { id: "x", name: "n", image: "i", state: "running", status: "Up" },
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
