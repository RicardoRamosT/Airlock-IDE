// packages/agent-core/src/redact/scan.ts
// Pure secret scanner: find vaulted VALUES (literal) and known secret PATTERNS in
// text, returning VALUE-FREE findings (name/type + 1-indexed line). Used by the
// main-side commit/status scan. ASCII-only (CJS-bundled into Electron main).

export interface SecretFinding {
  line: number; // 1-indexed
  kind: "vaulted" | "pattern";
  name?: string; // set when kind === "vaulted"
  patternType?: string; // set when kind === "pattern"
}

// Unanchored provider shapes mirroring broker/validators.ts (which anchors whole
// values). Excludes the public stripe-publishable shape. Advisory -- false
// positives are cheap under the advisory/agent-confirm model.
const SECRET_PATTERNS: { patternType: string; re: RegExp }[] = [
  { patternType: "stripe-secret", re: /sk_(live|test)_[A-Za-z0-9]{16,}/ },
  { patternType: "aws-access-key-id", re: /\b(AKIA|ASIA)[A-Z0-9]{16}\b/ },
  { patternType: "github-token", re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { patternType: "slack-token", re: /\bxox[bpars]-[A-Za-z0-9-]{10,}\b/ },
  { patternType: "anthropic-api-key", re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/ },
  { patternType: "pem-private-key", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  {
    patternType: "jwt",
    re: /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/,
  },
];

export function scanForSecrets(
  text: string,
  vaulted: { name: string; value: string }[],
): SecretFinding[] {
  const findings: SecretFinding[] = [];
  const seen = new Set<string>();
  const add = (line: number, f: Omit<SecretFinding, "line">): void => {
    const key = `${line}:${f.name ?? f.patternType ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({ line, ...f });
  };
  // 4-char floor matches the redactor: shorter values are noise.
  const values = vaulted.filter((s) => s.value.length >= 4);
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const lineNo = i + 1;
    for (const s of values) {
      if (line.includes(s.value)) add(lineNo, { kind: "vaulted", name: s.name });
    }
    for (const p of SECRET_PATTERNS) {
      if (p.re.test(line)) add(lineNo, { kind: "pattern", patternType: p.patternType });
    }
  }
  return findings;
}
