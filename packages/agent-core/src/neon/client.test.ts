import { describe, expect, it } from "vitest";
import {
  getCurrentUser,
  listBranches,
  listOrganizations,
  listProjects,
  type NeonTransport,
  neonAccountLabel,
  resolveNeonAccountId,
} from "./client";

describe("resolveNeonAccountId", () => {
  const accts = [
    { id: "a", label: "a@x.com" },
    { id: "b", label: "b@x.com" },
  ];
  it("keeps a valid binding", () => {
    expect(resolveNeonAccountId("b", accts)).toBe("b");
  });
  it("defaults to the sole account when exactly one exists", () => {
    expect(resolveNeonAccountId(null, [{ id: "a", label: "a@x.com" }])).toBe(
      "a",
    );
  });
  it("returns null when unbound with multiple, or bound to a gone account", () => {
    expect(resolveNeonAccountId(null, accts)).toBeNull();
    expect(resolveNeonAccountId("gone", accts)).toBeNull();
  });
  it("returns null when no accounts", () => {
    expect(resolveNeonAccountId(null, [])).toBeNull();
  });
});

// Records the paths the client builds so URL + org_id construction is verified
// without network. Returns shapes the parsers understand.
function fake(): { t: NeonTransport; gets: string[] } {
  const gets: string[] = [];
  const t: NeonTransport = {
    async get(path) {
      gets.push(path);
      if (path.startsWith("/users/me/organizations"))
        return { organizations: [{ id: "org-1", name: "GDL Motors" }] };
      if (path.startsWith("/projects"))
        return { projects: [{ id: "p1", name: "prod" }] };
      return { branches: [{ id: "br-1", name: "main" }] };
    },
  };
  return { t, gets };
}

describe("neon client", () => {
  it("listOrganizations hits /users/me/organizations", async () => {
    const { t, gets } = fake();
    const orgs = await listOrganizations("k", { transport: t });
    expect(gets[0]).toBe("/users/me/organizations");
    expect(orgs).toEqual([{ id: "org-1", name: "GDL Motors" }]);
  });

  it("listProjects scopes by org_id (url-encoded)", async () => {
    const { t, gets } = fake();
    const projects = await listProjects("k", "org-jolly fog/1", {
      transport: t,
    });
    expect(gets[0]).toBe("/projects?org_id=org-jolly%20fog%2F1");
    expect(projects).toEqual([{ id: "p1", name: "prod" }]);
  });

  it("listProjects with empty orgId lists via inferred /projects (org key)", async () => {
    const { t, gets } = fake();
    await listProjects("k", "", { transport: t });
    expect(gets[0]).toBe("/projects");
  });

  it("listBranches still targets the project's branches path", async () => {
    const { t, gets } = fake();
    await listBranches("k", "p1", { transport: t });
    expect(gets[0]).toBe("/projects/p1/branches");
  });

  it("getCurrentUser hits /users/me and parses the account", async () => {
    const t: NeonTransport = {
      async get(path) {
        expect(path).toBe("/users/me");
        return { id: "u-1", email: "me@example.com", name: "Me" };
      },
    };
    expect(await getCurrentUser("k", { transport: t })).toEqual({
      id: "u-1",
      email: "me@example.com",
      name: "Me",
    });
  });
});

describe("neonAccountLabel", () => {
  it("prefers email, then name, then an id fragment", () => {
    expect(neonAccountLabel({ id: "u", email: "a@b.com", name: "Ada" })).toBe(
      "a@b.com",
    );
    expect(neonAccountLabel({ id: "u", email: "", name: "Ada" })).toBe("Ada");
    expect(neonAccountLabel({ id: "abcdef123456", email: "", name: "" })).toBe(
      "Neon abcdef12",
    );
  });
});
