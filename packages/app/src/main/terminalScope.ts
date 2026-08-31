// ASCII comments only. Who may read a terminal's output, and whose project the
// read belongs to.
//
// This is an ISOLATION BOUNDARY, so it lives in its own file with its own test
// rather than inline in ipc.ts, where it would be electron wiring nobody
// exercises.
//
// Two kinds of caller:
//
//  - A PROJECT's Claude session carries a per-project token, so its root is
//    known. It may read only its own project's terminals. Unchanged.
//  - ATLAS carries no token. It is portfolio-wide by construction and has no
//    single project, so its root is null. That made every root-scoped tool
//    answer "No workspace open": Atlas could open a terminal and type into it
//    but never read it back, so it could not check its own work (2026-08-31).
//    Atlas already reads every project through Bash and Read, so a redacted
//    tail grants it nothing it did not have.
//
// Either way the answer names the OWNING project, so the caller's identity
// never decides which vault redacts the output or which audit log records the
// read.

export type TailScope =
  | { ok: true; scope: string }
  | { ok: false; error: string };

export function resolveTailScope(
  callerRoot: string | null,
  ownerRoot: string | null,
): TailScope {
  // An unknown terminal and another project's terminal answer THE SAME WAY.
  // Distinguishing them would let a caller probe for the existence of
  // terminals in projects it cannot read.
  if (ownerRoot === null) return { ok: false, error: "No such terminal" };
  if (callerRoot !== null && callerRoot !== ownerRoot)
    return { ok: false, error: "No such terminal" };
  return { ok: true, scope: ownerRoot };
}
