// packages/app/src/main/extensions/githubTools.ts
// The github_read_issue MCP tool logic, kept OUT of mcp/tools.ts because it reads
// the vaulted token (getSecretValue) -- a value-returning function the tools.ts
// source-guard forbids. mcp/tools.ts registers a thin wrapper that calls this via
// an injected dep (wired in mcp/server.ts). The token is used to call GitHub and
// never returned; only the issue's title/body/state/url (redacted downstream)
// leave main. Access is gated by the OAuth token's scopes (the agent must name a
// specific owner/repo/number).
import { getSecretValue } from "@airlock/agent-core";
import { oauthTokenName } from "./oauth/device";

// The subset of a GitHub issue we surface. Pure -> unit-tested.
export function parseIssue(json: unknown): {
  title: string;
  body: string;
  state: string;
  url: string;
} {
  const r =
    json && typeof json === "object" ? (json as Record<string, unknown>) : {};
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  return {
    title: s(r.title),
    body: s(r.body),
    state: s(r.state),
    url: s(r.html_url),
  };
}

export interface GithubIssueResult {
  title?: string;
  body?: string;
  state?: string;
  url?: string;
  error?: string;
}

export async function githubReadIssueTool(
  root: string | null,
  owner: string,
  repo: string,
  issue: number,
): Promise<GithubIssueResult> {
  if (!root) return { error: "No project is focused." };
  const token = await getSecretValue(root, oauthTokenName("github")).catch(
    () => null,
  );
  if (!token) return { error: "GitHub is not connected for this project." };
  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/issues/${issue}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
        },
      },
    );
    if (!res.ok) return { error: `GitHub request failed (${res.status}).` };
    return parseIssue(await res.json());
  } catch {
    return { error: "GitHub request failed." };
  }
}
