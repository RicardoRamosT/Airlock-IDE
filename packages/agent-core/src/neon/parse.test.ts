import { describe, expect, it } from "vitest";
import {
  parseBranches,
  parseConnectionUri,
  parseDatabases,
  parseProjects,
} from "./parse";

describe("parseProjects", () => {
  it("maps id and name from the projects array", () => {
    expect(
      parseProjects({
        projects: [
          { id: "p1", name: "prod" },
          { id: "p2", name: "dev" },
        ],
      }),
    ).toEqual([
      { id: "p1", name: "prod" },
      { id: "p2", name: "dev" },
    ]);
  });

  it("returns [] when projects is missing or empty", () => {
    expect(parseProjects({})).toEqual([]);
    expect(parseProjects({ projects: [] })).toEqual([]);
    expect(parseProjects(null)).toEqual([]);
  });

  it("defaults missing string fields to empty string", () => {
    expect(parseProjects({ projects: [{ id: "p1" }] })).toEqual([
      { id: "p1", name: "" },
    ]);
  });
});

describe("parseBranches", () => {
  it("maps id and name from the branches array", () => {
    expect(parseBranches({ branches: [{ id: "br-1", name: "main" }] })).toEqual(
      [{ id: "br-1", name: "main" }],
    );
  });

  it("returns [] when branches is missing or empty", () => {
    expect(parseBranches({})).toEqual([]);
    expect(parseBranches({ branches: [] })).toEqual([]);
  });

  it("defaults missing string fields to empty string", () => {
    expect(parseBranches({ branches: [{ name: "main" }] })).toEqual([
      { id: "", name: "main" },
    ]);
  });
});

describe("parseDatabases", () => {
  it("maps name and owner_name (to ownerName) from the databases array", () => {
    expect(
      parseDatabases({
        databases: [{ name: "neondb", owner_name: "neondb_owner" }],
      }),
    ).toEqual([{ name: "neondb", ownerName: "neondb_owner" }]);
  });

  it("returns [] when databases is missing or empty", () => {
    expect(parseDatabases({})).toEqual([]);
    expect(parseDatabases({ databases: [] })).toEqual([]);
  });

  it("defaults missing string fields to empty string", () => {
    expect(parseDatabases({ databases: [{ name: "neondb" }] })).toEqual([
      { name: "neondb", ownerName: "" },
    ]);
  });
});

describe("parseConnectionUri", () => {
  it("returns the uri string", () => {
    expect(parseConnectionUri({ uri: "postgres://u:p@h/db" })).toBe(
      "postgres://u:p@h/db",
    );
  });

  it("throws when uri is absent", () => {
    expect(() => parseConnectionUri({})).toThrow();
    expect(() => parseConnectionUri(null)).toThrow();
  });

  it("throws when uri is non-string", () => {
    expect(() => parseConnectionUri({ uri: 123 })).toThrow();
  });
});
