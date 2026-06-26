// Friendly presentation for audit-log ops: a human label + a codicon, plus a
// one-line summary pulled from the entry's detail. Pure so it unit-tests; the
// AuditSection just renders what these return.

const LABELS: Record<string, { label: string; icon: string }> = {
  // Secrets / broker
  "secret.set": { label: "Vaulted a secret", icon: "key" },
  "secret.delete": { label: "Deleted a secret", icon: "trash" },
  "secret.inject": { label: "Injected secrets", icon: "arrow-right" },
  "secret.import": { label: "Imported .env", icon: "arrow-down" },
  "secret.reveal": { label: "Revealed a secret", icon: "eye" },
  "secret.copy": { label: "Copied a secret", icon: "copy" },
  "secret.inject.blocked": { label: "Blocked an inject", icon: "shield" },
  "secret.global.set": { label: "Set a global secret", icon: "key" },
  "secret.global.delete": { label: "Cleared a global secret", icon: "trash" },
  // Git
  "git.commit": { label: "Committed", icon: "git-commit" },
  "git.commit.blocked": { label: "Blocked a commit (secret)", icon: "shield" },
  "git.push": { label: "Pushed", icon: "repo-push" },
  "git.pull": { label: "Pulled", icon: "repo-pull" },
  "git.fetch": { label: "Fetched", icon: "sync" },
  "git.stage": { label: "Staged", icon: "add" },
  "git.unstage": { label: "Unstaged", icon: "remove" },
  "git.discard": { label: "Discarded changes", icon: "discard" },
  "git.uncommit": { label: "Undid last commit", icon: "history" },
  "git.branch.switch": { label: "Switched branch", icon: "git-branch" },
  "git.branch.create": { label: "Created branch", icon: "git-branch" },
  // Files
  "file.create": { label: "Created file", icon: "new-file" },
  "folder.create": { label: "Created folder", icon: "new-folder" },
  "file.move": { label: "Moved / renamed", icon: "arrow-right" },
  "file.duplicate": { label: "Duplicated", icon: "files" },
  "file.delete": { label: "Deleted", icon: "trash" },
  // Commands / terminal (agent)
  "command.run": { label: "Ran a command", icon: "terminal" },
  "command.run.blocked": { label: "Blocked a command", icon: "shield" },
  "command.policy.blocked": { label: "Blocked a command", icon: "shield" },
  "terminal.read": { label: "Read terminal output", icon: "eye" },
  // Integrations
  "neon.account.add": { label: "Added a Neon account", icon: "add" },
  "neon.account.bind": { label: "Switched Neon account", icon: "account" },
  "neon.account.remove": { label: "Removed a Neon account", icon: "trash" },
  "render.connect": { label: "Connected Render", icon: "plug" },
  "render.deploy": { label: "Triggered a deploy", icon: "rocket" },
};

export function auditLabel(op: string): { label: string; icon: string } {
  return LABELS[op] ?? { label: op, icon: "circle-small-filled" };
}

const isStr = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0;

// A short, human summary of the most notable field in an entry's detail (the
// secret name, the branch, the path, a count, ...). "" when nothing notable.
export function auditSummary(detail: Record<string, unknown>): string {
  const d = detail ?? {};
  if (isStr(d.from) && isStr(d.to)) return `${d.from} → ${d.to}`;
  if (isStr(d.name)) return d.name;
  if (isStr(d.label)) return d.label;
  if (isStr(d.to)) return d.to;
  if (isStr(d.path)) return d.path;
  if (isStr(d.service)) return d.service;
  if (isStr(d.command)) return d.command;
  if (isStr(d.file)) return d.file;
  if (typeof d.count === "number")
    return `${d.count} file${d.count === 1 ? "" : "s"}`;
  if (typeof d.sha === "string" && d.sha) return d.sha.slice(0, 7);
  return "";
}
