// trust.ts -- which ESLint units the user has allowed to run.
//
// Running a project's ESLint executes its eslint.config.* and every plugin it
// imports, i.e. arbitrary code from the repo. So linting starts only after an
// explicit grant, and the grant is stored in AirLock's userData, NEVER in the
// repo: .airlock/config.json can be committed by a repo author, so a flag
// there would be forgeable by the very code it guards.
//
// Keyed by REALPATH, so a symlink cannot borrow another folder's grant, and a
// folder that was renamed or removed is simply untrusted again -- a grant is
// never honoured through a path that no longer resolves.
export interface TrustFs {
  /** null = absent or unreadable. */
  read(file: string): string | null;
  /** Must be atomic (write a temp file, then rename). */
  write(file: string, data: string): void;
  /** null = the path does not exist. */
  realpath(p: string): string | null;
}

export class TrustStore {
  private readonly dirs: Set<string>;

  constructor(
    private readonly file: string,
    private readonly fs: TrustFs,
  ) {
    this.dirs = new Set(parseStore(fs.read(file)));
  }

  isTrusted(absDir: string): boolean {
    const real = this.fs.realpath(absDir);
    return real !== null && this.dirs.has(real);
  }

  set(absDir: string, on: boolean): void {
    const real = this.fs.realpath(absDir);
    if (real === null) throw new Error("ESLint folder not found");
    if (on) this.dirs.add(real);
    else this.dirs.delete(real);
    this.fs.write(
      this.file,
      `${JSON.stringify({ version: 1, trusted: [...this.dirs].sort() }, null, 2)}\n`,
    );
  }
}

// A corrupt or hand-mangled store trusts NOTHING: failing closed costs one
// re-prompt, failing open would run code nobody approved.
function parseStore(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as { trusted?: unknown };
    return Array.isArray(v.trusted)
      ? v.trusted.filter((d): d is string => typeof d === "string")
      : [];
  } catch {
    return [];
  }
}
