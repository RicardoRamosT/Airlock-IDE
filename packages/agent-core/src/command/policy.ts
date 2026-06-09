// Pure agent command policy: classify a shell command's risk categories and
// resolve the user's policy + confirm into run-or-block. Heuristic (reads the
// command string) -- catches the obvious dangerous patterns; deep OS isolation
// is a later slice. ASCII-only (CJS-bundled into Electron main).

export type RiskCategory =
  | "network"
  | "outsideWorkspace"
  | "destructive"
  | "privilege";

export type RiskAction = "allow" | "ask" | "block";
export type AgentCommandPolicy = Record<RiskCategory, RiskAction>;

export const DEFAULT_AGENT_POLICY: AgentCommandPolicy = {
  network: "allow",
  outsideWorkspace: "ask",
  destructive: "ask",
  privilege: "block",
};

// Binary-name patterns allow an OPTIONAL leading path component -- (\S*\/)? --
// so an invocation BY PATH (/usr/bin/sudo, ./sudo, /bin/rm) classifies the same
// as the bare name. Matching only a separator-delimited basename was a bypass:
// the audit flagged it for sudo (H3), and the same hole defeated the network and
// destructive binaries too, so the prefix is applied across the class.
// The tilde pattern matches a leading "~" token followed by a path char, a
// separator, or end -- a trailing \b never sat between "~" and "/", so "~/.ssh"
// (the spec's own example) and a bare "cd ~" were silently missed (H2). The home
// variable is matched as $HOME and ${HOME} (the braced form was also missed).
const PATTERNS: { category: RiskCategory; re: RegExp }[] = [
  {
    category: "privilege",
    re: /(^|[\s;&|])(\S*\/)?(sudo|doas|pkexec|su)([\s;&|]|$)/,
  },
  {
    category: "network",
    re: /(^|[\s;&|])(\S*\/)?(curl|wget|nc|ncat|telnet|ssh|scp|sftp|ftp)([\s;&|]|$)/,
  },
  { category: "destructive", re: /(^|[\s;&|])(\S*\/)?rm\s+-\w*[rf]/ },
  { category: "destructive", re: /git\s+push\b[^;&|]*\s(--force|-f)\b/ },
  { category: "destructive", re: /git\s+reset\s+--hard/ },
  { category: "destructive", re: /git\s+clean\s+-\w*[fd]/ },
  {
    category: "destructive",
    re: /(^|[\s;&|])(\S*\/)?(dd|mkfs\w*|shred|truncate)([\s;&|]|$)/,
  },
  { category: "outsideWorkspace", re: /(^|[\s;&|])~([\w.-]*\/|[\s;&|]|$)/ },
  { category: "outsideWorkspace", re: /\$\{?HOME\b/ },
  { category: "outsideWorkspace", re: /\.\.\// },
  { category: "outsideWorkspace", re: /(^|\s)\/(etc|root)\b/ },
  { category: "outsideWorkspace", re: /\/\.(ssh|aws|gnupg|config)\b/ },
];

export function classifyCommand(command: string): RiskCategory[] {
  const hit = new Set<RiskCategory>();
  for (const p of PATTERNS) if (p.re.test(command)) hit.add(p.category);
  return [...hit];
}

const RANK: Record<RiskAction, number> = { allow: 0, ask: 1, block: 2 };

const REASONS: Record<RiskCategory, string> = {
  network: "reaches the network",
  outsideWorkspace: "touches files outside the project",
  destructive: "is destructive",
  privilege: "uses elevated privileges",
};

export type GateResult =
  | { run: true }
  | {
      run: false;
      action: "ask" | "block";
      categories: RiskCategory[];
      reason: string;
    };

// Resolve a command against the policy + confirm. Strictest matched action wins
// (block > ask > allow); none -> allow. Block is absolute; ask is overridden by
// confirm. Returns run:true to execute, else the block details.
export function gateCommand(
  command: string,
  policy: AgentCommandPolicy,
  confirm: boolean,
): GateResult {
  const categories = classifyCommand(command);
  let action: RiskAction = "allow";
  for (const c of categories)
    if (RANK[policy[c]] > RANK[action]) action = policy[c];
  if (action === "allow") return { run: true };
  if (action === "ask" && confirm) return { run: true };
  const reason = `This command ${categories.map((c) => REASONS[c]).join(" and ")}.`;
  return { run: false, action, categories, reason };
}
