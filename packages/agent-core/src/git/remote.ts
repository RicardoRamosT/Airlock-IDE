import { runGit } from "./run";

export interface ParsedRemote {
  host: string;
  owner: string;
  repo: string;
  protocol: "https" | "ssh";
}

// Parse a git remote URL into its parts. Supports https, scp-style (git@host:),
// and ssh:// forms; strips a trailing .git and slash. Returns null otherwise.
export function parseRemote(url: string): ParsedRemote | null {
  const https = url.match(
    /^https?:\/\/(?:[^@/]+@)?([^/]+)\/([^/]+)\/(.+?)(?:\.git)?\/?$/,
  );
  if (https?.[1] && https[2] && https[3]) {
    return {
      host: https[1],
      owner: https[2],
      repo: https[3],
      protocol: "https",
    };
  }
  const scp = url.match(/^[^@\s]+@([^:]+):([^/]+)\/(.+?)(?:\.git)?\/?$/);
  if (scp?.[1] && scp[2] && scp[3]) {
    return { host: scp[1], owner: scp[2], repo: scp[3], protocol: "ssh" };
  }
  const ssh = url.match(
    /^ssh:\/\/(?:[^@/]+@)?([^/]+)\/([^/]+)\/(.+?)(?:\.git)?\/?$/,
  );
  if (ssh?.[1] && ssh[2] && ssh[3]) {
    return { host: ssh[1], owner: ssh[2], repo: ssh[3], protocol: "ssh" };
  }
  return null;
}

// Read the origin remote URL (thin wrapper over runGit; returns null if there
// is no origin remote).
export async function getOrigin(root: string): Promise<string | null> {
  try {
    return (await runGit(root, ["remote", "get-url", "origin"])).trim() || null;
  } catch {
    return null;
  }
}
