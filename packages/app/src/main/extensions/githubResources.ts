// packages/app/src/main/extensions/githubResources.ts
// Pure helpers for surfacing a repo's open issues + PRs as sidebar resources.
// Kept separate from github.ts (the I/O provider) so they unit-test electron-free.
import type { IntegrationItem } from "@airlock/agent-core";

// Extract owner/repo from an origin remote URL (https or ssh form); null for a
// non-GitHub remote or no remote.
export function parseGithubRemote(
  url: string | null,
): { owner: string; repo: string } | null {
  if (!url) return null;
  const m = url.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (!m) return null;
  const [, owner, repo] = m;
  return owner && repo ? { owner, repo } : null;
}

export interface GithubIssueRow {
  number: number;
  title: string;
  url: string;
  isPr: boolean;
}

// GitHub's issues endpoint returns PRs too, distinguished by `pull_request`.
export function parseIssuesPayload(json: unknown): GithubIssueRow[] {
  if (!Array.isArray(json)) return [];
  const rows: GithubIssueRow[] = [];
  for (const it of json) {
    if (!it || typeof it !== "object") continue;
    const r = it as Record<string, unknown>;
    if (typeof r.number !== "number") continue;
    rows.push({
      number: r.number,
      title: typeof r.title === "string" ? r.title : "",
      url: typeof r.html_url === "string" ? r.html_url : "",
      isPr: "pull_request" in r && Boolean(r.pull_request),
    });
  }
  return rows;
}

// PRs first, then issues; each capped and mapped to a neutral IntegrationItem.
export function issuesToItems(
  rows: GithubIssueRow[],
  cap = 20,
): IntegrationItem[] {
  const toItem = (r: GithubIssueRow): IntegrationItem => ({
    id: `int:github:${r.isPr ? "pr" : "issue"}:${r.number}`,
    title: `#${r.number} ${r.title}`,
    subtitle: r.isPr ? "pull request" : "issue",
    state: "idle",
    href: r.url,
  });
  const prs = rows
    .filter((r) => r.isPr)
    .slice(0, cap)
    .map(toItem);
  const issues = rows
    .filter((r) => !r.isPr)
    .slice(0, cap)
    .map(toItem);
  return [...prs, ...issues];
}
