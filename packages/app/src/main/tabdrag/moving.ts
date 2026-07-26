// packages/app/src/main/tabdrag/moving.ts
// Single-use tickets for PTY sessions being moved between windows.
//
// pty:adopt re-points a live pty's output to a different window, which crosses the
// per-window terminal isolation boundary (sessionWindows). So it is admitted ONLY
// for a session main itself just marked as moving: without this, any window could
// adopt any pty by guessing an id. Tickets are single-use so a replayed adopt
// cannot re-point a session a second time.
//
// ASCII-only comments (CJS-bundled into Electron main).
export class MovingSessions {
  private ids = new Set<string>();

  // Mark the pty ids in a moving tab. Nulls are ignored: a pane that never
  // spawned has nothing to adopt.
  mark(ids: readonly (string | null)[]): void {
    for (const id of ids) if (id) this.ids.add(id);
  }

  // Consume the ticket. True exactly once per mark.
  claim(id: string): boolean {
    return this.ids.delete(id);
  }

  forget(id: string): void {
    this.ids.delete(id);
  }

  size(): number {
    return this.ids.size;
  }
}
