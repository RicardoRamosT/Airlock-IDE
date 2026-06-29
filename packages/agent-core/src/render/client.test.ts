import { describe, expect, it } from "vitest";
import {
  latestDeploy,
  listDeploys,
  listEnvVars,
  listServices,
  type RenderTransport,
  triggerDeploy,
} from "./client";

// In-memory transport recording the paths/bodies the client builds, so the URL
// + method construction is verified without network.
function fake(): {
  t: RenderTransport;
  gets: string[];
  posts: { path: string; body: unknown }[];
} {
  const gets: string[] = [];
  const posts: { path: string; body: unknown }[] = [];
  const t: RenderTransport = {
    async get(path) {
      gets.push(path);
      if (path.includes("/deploys"))
        return [
          { deploy: { id: "d1", status: "live", commit: { id: "abc" } } },
        ];
      return [{ service: { id: "srv-1", name: "web" } }];
    },
    async post(path, _key, body) {
      posts.push({ path, body });
      return null;
    },
  };
  return { t, gets, posts };
}

describe("render client", () => {
  it("listServices hits /services", async () => {
    const { t, gets } = fake();
    const out = await listServices("k", { transport: t });
    expect(gets[0]).toBe("/services?limit=100");
    expect(out[0]?.id).toBe("srv-1");
  });

  it("listDeploys requests the given limit and url-encodes the id", async () => {
    const { t, gets } = fake();
    const out = await listDeploys("k", "srv a/b", 5, { transport: t });
    expect(gets[0]).toBe("/services/srv%20a%2Fb/deploys?limit=5");
    expect(out).toHaveLength(1);
  });

  it("latestDeploy requests a single deploy", async () => {
    const { t, gets } = fake();
    await latestDeploy("k", "srv-1", { transport: t });
    expect(gets[0]).toBe("/services/srv-1/deploys?limit=1");
  });

  it("triggerDeploy POSTs to the service's deploys endpoint", async () => {
    const { t, posts } = fake();
    await triggerDeploy("k", "srv-1", { transport: t });
    expect(posts).toEqual([{ path: "/services/srv-1/deploys", body: {} }]);
  });

  it("listEnvVars fetches the service env-vars path and parses them", async () => {
    const calls: string[] = [];
    const transport = {
      get: async (path: string) => {
        calls.push(path);
        return [
          { envVar: { key: "FOO", value: "bar" } },
          { envVar: { key: "BAZ", value: "qux" } },
        ];
      },
      post: async () => null,
    };
    const result = await listEnvVars("k", "srv-123", { transport });
    expect(calls).toEqual(["/services/srv-123/env-vars?limit=100"]);
    expect(result).toEqual([
      { key: "FOO", value: "bar" },
      { key: "BAZ", value: "qux" },
    ]);
  });
});
