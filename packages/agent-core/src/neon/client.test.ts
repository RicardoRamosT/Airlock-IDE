import { describe, expect, it } from "vitest";
import {
  listBranches,
  listOrganizations,
  listProjects,
  type NeonTransport,
} from "./client";

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

  it("listBranches still targets the project's branches path", async () => {
    const { t, gets } = fake();
    await listBranches("k", "p1", { transport: t });
    expect(gets[0]).toBe("/projects/p1/branches");
  });
});
