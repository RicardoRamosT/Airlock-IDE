// Turn dropped file paths into text to paste into a terminal. Pure -> unit
// tested. A path is shell-quoted only when it contains anything outside a safe
// set, so a normal path stays readable; an embedded single quote uses the POSIX
// '\'' escape. terminalDropText joins multiple paths and adds a trailing space
// so the pasted path sits ready in a command you are typing (no newline -- we
// never submit).

// Chars safe to leave unquoted in a POSIX shell word.
const SAFE_PATH = /^[\w@%+=:,./-]+$/;

export function shellQuotePath(p: string): string {
  if (p === "") return "''";
  if (SAFE_PATH.test(p)) return p;
  return `'${p.replace(/'/g, "'\\''")}'`;
}

export function terminalDropText(paths: string[]): string | null {
  const clean = paths.filter((p) => p.length > 0);
  if (clean.length === 0) return null;
  return `${clean.map(shellQuotePath).join(" ")} `;
}
