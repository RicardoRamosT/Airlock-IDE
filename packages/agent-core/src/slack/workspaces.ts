// packages/agent-core/src/slack/workspaces.ts
// Pure workspace model for the Slack connect flow. Import-free ON PURPOSE:
// slack/parse.ts depends on this file, so a dependency the other way would be a
// cycle. Everything here degrades to an empty/false value rather than throwing --
// a workspace hint is advisory, and a bad hint must never break a connect.

// What the user ASKED for. Either half may be missing: the picker supplies both,
// a pasted `app.slack.com/client/T…` link supplies only the id, and a pasted
// workspace URL supplies only the subdomain.
export interface WorkspaceTarget {
  teamId?: string;
  domain?: string;
}

// Slack team ids are "T" + alphanumerics. Case-insensitive because people paste
// lower-cased URLs; we upper-case on the way out.
const TEAM_ID = /^T[A-Z0-9]{6,}$/i;
// A workspace subdomain: DNS-label characters only. Anything outside this set
// can never reach a URL host, so `<domain>.slack.com` is always well-formed.
const SLUG = /^[a-z0-9][a-z0-9-]*$/i;
// slack.com subdomains that are Slack's own surfaces, never a workspace.
const RESERVED = new Set([
  "app",
  "api",
  "my",
  "files",
  "www",
  "slack",
  "status",
]);

export function parseWorkspaceInput(text: string): WorkspaceTarget {
  const s = (text ?? "").trim();
  if (!s) return {};
  // Bare team id FIRST: "T0123ABCD" also looks like a legal slug.
  if (TEAM_ID.test(s)) return { teamId: s.toUpperCase() };
  // A dotless slug is a workspace name, not a host.
  if (!s.includes(".") && !s.includes("/") && SLUG.test(s)) {
    return { domain: s.toLowerCase() };
  }
  // Everything else gets read as a URL. A missing scheme is assumed https so a
  // bare "acme.slack.com" from the address bar parses.
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`;
  let host: string;
  let pathname: string;
  try {
    const u = new URL(withScheme);
    host = u.hostname.toLowerCase();
    pathname = u.pathname;
  } catch {
    return {};
  }
  const out: WorkspaceTarget = {};
  const client = pathname.match(/\/client\/(T[A-Z0-9]{6,})/i);
  if (client?.[1]) out.teamId = client[1].toUpperCase();
  const sub = host.match(/^([a-z0-9][a-z0-9-]*)\.slack\.com$/);
  if (sub?.[1] && !RESERVED.has(sub[1])) out.domain = sub[1];
  return out;
}
