// ASCII comments only. What Atlas is still worried about, and for how long.
//
// The debrief is composed fresh from a snapshot every day, so Atlas had no
// memory of what it said yesterday. It told the user "N commits exist only on
// this machine, no remote" on EVERY run for six days -- 28, 32, 41, 44 -- and
// could neither say "ninth time, and the number has grown" nor notice if the
// risk had been fixed. A warning restated identically is one the reader learns
// to skim.
//
// THE AXIS IS CONSEQUENCE WITH A CLOCK, not activity. An earlier draft tracked
// projects that had gone quiet; the user rejected it, and the reason is the
// whole design:
//
//   "not specifically repos stopped moving, if that happens is normally
//    because I prioritized something else"
//
// With 21 projects, most are quiet most of the time. A quiet repository is a
// CHOICE and flagging it would be right almost never. What actually slips is
// something with a consequence and a clock: a date that arrives, a blocker that
// ages, a number that compounds.
//
// Detection is PURE and free -- no model call, ever. It runs inside the
// portfolio refresh that already happens, which is what lets tier 1 be
// always-on. The expensive half ("look into this") is on demand only.

import type { RootSnapshot } from "./collect";
import { type AtlasFact, liveFacts } from "./facts";

const DAY = 24 * 60 * 60 * 1000;

// Below this, unpushed commits are just work in progress.
export const UNPUSHED_THRESHOLD = 10;
// A deadline becomes a concern once it is this close, and stays one after it
// passes.
export const DEADLINE_HORIZON_DAYS = 14;
// A blocker is only interesting once it has failed to move.
export const BLOCKER_AGE_DAYS = 7;

export type ConcernSource = "git" | "deadline" | "blocker" | "atlas";

// A concern as stored: identity plus the history that makes it worth showing.
export interface Concern {
  key: string;
  source: ConcernSource;
  // The root this was derived from, or null when it did not come from one.
  // Resolution safety keys off this -- see reconcileConcerns.
  root: string | null;
  project: string | null; // display name; null means portfolio-wide
  title: string;
  detail: string; // what it was derived from, for the drill-down
  firstSeenAt: number;
  lastSeenAt: number;
  // The trend, git-derived only. A model-raised concern cannot be re-measured,
  // and inventing a trend from two model utterances would be exactly the
  // confident-wrong-number this design exists to avoid.
  firstValue: number | null;
  lastValue: number | null;
  resolvedAt: number | null;
}

// What detection produces: true right now, with no history attached.
export interface DetectedConcern {
  key: string;
  source: ConcernSource;
  root: string | null;
  project: string | null;
  title: string;
  detail: string;
  value: number | null;
}

// THE KEY FORMAT FOR A VANISHED FOLDER, in one place.
//
// A missing folder is the one concern the user can act on by deleting rather
// than by fixing: the project is gone, so the row and its concern have to be
// forgettable. That action needs the ROOT, and the only place it is recorded
// is inside the key -- so the builder and the reader live together here rather
// than having a surface re-derive the format and drift from it.
const MISSING_SUFFIX = "|missing";

export function missingConcernKey(root: string): string {
  return `${root}${MISSING_SUFFIX}`;
}

// The root a concern says has vanished, or null when it says nothing of the
// kind. Deliberately strict: the source must be `git` (a MEASURED observation),
// so a model-raised concern cannot wear the key and hand the user a button that
// deletes a live project's registry row.
export function missingRootOf(
  c: Pick<Concern, "key" | "source" | "root">,
): string | null {
  if (c.source !== "git" || c.root === null) return null;
  return c.key === missingConcernKey(c.root) ? c.root : null;
}

function name(root: string): string {
  const parts = root.split("/").filter((p) => p.length > 0);
  return parts.length > 0 ? (parts[parts.length - 1] as string) : root;
}

// A project the user has deliberately stopped. Saying "ElArqui is parked" in
// ordinary conversation is how you tell Atlas to stop worrying -- there is
// deliberately no dismiss button, because a button would be a second competing
// way to say the same thing and the user's own words are the better record.
const PARKED = /\b(parked|dead|paused|shelved|on hold|done|finished)\b/i;

function parkedProjects(facts: readonly AtlasFact[]): Set<string> {
  const out = new Set<string>();
  for (const f of liveFacts(facts)) {
    if (f.kind === "status" && f.project && PARKED.test(f.value)) {
      out.add(f.project);
    }
  }
  return out;
}

// Dates only, and only unambiguous ones: a deadline we cannot read is skipped
// rather than guessed, because a wrong date here produces a confident wrong
// warning.
function parseDeadline(value: string): number | null {
  const m = /(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(t) ? t : null;
}

export function detectConcerns(
  snaps: readonly RootSnapshot[],
  facts: readonly AtlasFact[],
  now: number,
): DetectedConcern[] {
  const parked = parkedProjects(facts);
  const out: DetectedConcern[] = [];

  for (const s of snaps) {
    const project = name(s.root);
    if (parked.has(project)) continue;

    if (s.missing) {
      out.push({
        key: missingConcernKey(s.root),
        source: "git",
        root: s.root,
        project,
        title: "folder is gone from disk",
        detail: `${s.root} was in the registry but is no longer on disk.`,
        value: null,
      });
      continue;
    }
    if (!s.isRepo) continue;

    if (s.upstream === null) {
      // Not ALSO unpushed: with no upstream there is nothing to be ahead of,
      // and reporting both would double-count one situation.
      out.push({
        key: `${s.root}|no-remote`,
        source: "git",
        root: s.root,
        project,
        title: "no remote",
        detail: `${project} has no upstream, so its commits exist only on this machine.`,
        value: s.ahead,
      });
    } else if (s.ahead >= UNPUSHED_THRESHOLD) {
      out.push({
        key: `${s.root}|unpushed`,
        source: "git",
        root: s.root,
        project,
        title: `${s.ahead} unpushed on ${s.branch ?? "the current branch"}`,
        detail: `${project} is ${s.ahead} commits ahead of ${s.upstream}.`,
        value: s.ahead,
      });
    }
    // `dirty` is deliberately not a detector: uncommitted files are ordinary
    // working state, not a consequence, and it would fire on every project the
    // user is actively editing.
  }

  for (const f of liveFacts(facts)) {
    if (f.project && parked.has(f.project)) continue;

    if (f.kind === "deadline") {
      const due = parseDeadline(f.value);
      if (due === null) continue;
      const daysLeft = Math.round((due - now) / DAY);
      if (daysLeft > DEADLINE_HORIZON_DAYS) continue;
      out.push({
        key: `${f.project ?? "*"}|deadline`,
        source: "deadline",
        root: null,
        project: f.project,
        title:
          daysLeft < 0
            ? `deadline passed ${-daysLeft}d ago`
            : `due in ${daysLeft}d`,
        detail: `You said: "${f.verbatim}"`,
        value: null,
      });
      continue;
    }

    if (f.kind === "blocker") {
      const days = Math.floor((now - f.saidAt) / DAY);
      if (days < BLOCKER_AGE_DAYS) continue;
      out.push({
        key: `${f.project ?? "*"}|blocker`,
        source: "blocker",
        root: null,
        project: f.project,
        title: `blocked ${days}d: ${f.value}`,
        detail: `You said: "${f.verbatim}"`,
        value: null,
      });
    }
  }

  return out;
}

// Fold what is true NOW onto what was already open.
//
// RESOLUTION SAFETY is the load-bearing part. collectAll degrades: a root whose
// git call fails yields no snapshot, so its concerns simply are not detected
// this run. If absence alone meant resolved, one failed call would silently
// close every concern for that project and tell the user a danger had cleared
// when nothing had changed -- the same "a failed read looked like an absent
// file" pattern removed from five call sites on 2026-08-30.
//
// So a concern derived from a root is only resolved when that root was actually
// covered. Fact-derived concerns have no root and resolve by absence, because
// facts are read whole and there is no partial coverage. Atlas-raised concerns
// never auto-resolve: no detector can re-derive them, so absence proves nothing.
export function reconcileConcerns(
  open: readonly Concern[],
  detected: readonly DetectedConcern[],
  coveredRoots: ReadonlySet<string>,
  now: number,
): Concern[] {
  const seen = new Map(detected.map((d) => [d.key, d] as const));
  const out: Concern[] = [];

  for (const c of open) {
    const hit = seen.get(c.key);
    if (hit) {
      seen.delete(c.key);
      const reopening = c.resolvedAt !== null;
      out.push({
        ...c,
        title: hit.title, // the wording can move with the numbers
        detail: hit.detail,
        // A reopened concern starts its age again: "how long has this been
        // true" means this time, not cumulatively.
        firstSeenAt: reopening ? now : c.firstSeenAt,
        firstValue: reopening ? hit.value : c.firstValue,
        lastSeenAt: now,
        lastValue: hit.value,
        resolvedAt: null,
      });
      continue;
    }

    const alreadyResolved = c.resolvedAt !== null;
    const canResolve =
      c.source !== "atlas" && (c.root === null || coveredRoots.has(c.root));
    if (alreadyResolved || !canResolve) {
      out.push(c); // untouched: not refreshed, not resolved
      continue;
    }
    out.push({ ...c, resolvedAt: now });
  }

  for (const d of seen.values()) {
    out.push({
      key: d.key,
      source: d.source,
      root: d.root,
      project: d.project,
      title: d.title,
      detail: d.detail,
      firstSeenAt: now,
      lastSeenAt: now,
      firstValue: d.value,
      lastValue: d.value,
      resolvedAt: null,
    });
  }

  return out;
}

// A concern Atlas raised in a reply. It supplies its own key and is shown the
// open ones each run so it can REUSE one rather than mint a duplicate.
export interface IncomingConcern {
  key: string;
  project: string | null;
  title: string;
  detail: string;
  resolved?: boolean;
}

// Fold concerns Atlas raised into the stored set.
//
// THE BOUNDARY THAT MATTERS: Atlas may only create or close concerns of its own
// source. A git/deadline/blocker concern is derived from a signal, and letting a
// model declare "no-remote is resolved" would clear a real warning that nothing
// had fixed. The next refresh would re-raise it, but in the meantime the user
// would have been told a danger had passed. So a key belonging to a measured
// concern is ignored outright.
export function mergeAtlasConcerns(
  open: readonly Concern[],
  incoming: readonly IncomingConcern[],
  now: number,
): Concern[] {
  const out = open.map((c) => ({ ...c }));
  const byKey = new Map(out.map((c) => [c.key, c] as const));

  for (const inc of incoming) {
    if (!inc.key || inc.key.trim().length === 0) continue;
    const existing = byKey.get(inc.key);

    if (existing) {
      if (existing.source !== "atlas") continue; // measured: not Atlas's to touch
      existing.title = inc.title;
      existing.detail = inc.detail;
      if (inc.resolved === true) {
        existing.resolvedAt = now;
      } else {
        // Reopening restarts the age: "how long has this been true" means this
        // time, matching reconcileConcerns.
        if (existing.resolvedAt !== null) existing.firstSeenAt = now;
        existing.resolvedAt = null;
        existing.lastSeenAt = now;
      }
      continue;
    }

    // Nothing to close that does not exist.
    if (inc.resolved === true) continue;

    const fresh: Concern = {
      key: inc.key,
      source: "atlas",
      root: null,
      project: inc.project,
      title: inc.title,
      detail: inc.detail,
      firstSeenAt: now,
      lastSeenAt: now,
      // Never a trend: see IncomingConcern.
      firstValue: null,
      lastValue: null,
      resolvedAt: null,
    };
    out.push(fresh);
    byKey.set(fresh.key, fresh);
  }

  return out;
}

// Open concerns, worst clock first: a deadline outranks an ageing blocker,
// which outranks a compounding number. Ties break on age.
export function openConcerns(all: readonly Concern[]): Concern[] {
  const rank: Record<ConcernSource, number> = {
    deadline: 0,
    blocker: 1,
    atlas: 2,
    git: 3,
  };
  return all
    .filter((c) => c.resolvedAt === null)
    .sort(
      (a, b) =>
        rank[a.source] - rank[b.source] || a.firstSeenAt - b.firstSeenAt,
    );
}

// How many standing concerns the debrief shows before it says "+N more".
export const MAX_SHOWN_CONCERNS = 8;

function ageDays(c: Concern, now: number): number {
  return Math.max(0, Math.floor((now - c.firstSeenAt) / DAY));
}

// RENDERED BY CODE, not by the model.
//
// The model writes TODAY -- judgement, prose, priorities. This block is
// appended afterwards, from the table, and is never put in the prompt as
// something to reword. If the model wrote it, it could paraphrase an age, drop
// a line, or round 44 to "over forty", and the entire value of this feature is
// that these figures are true.
export function renderStillOpen(all: readonly Concern[], now: number): string {
  const open = openConcerns(all);
  if (open.length === 0) return "";

  const shown = open.slice(0, MAX_SHOWN_CONCERNS);
  const lines = shown.map((c) => {
    const bits: string[] = [];
    if (c.project) bits.push(c.project);
    bits.push(c.title);
    const days = ageDays(c, now);
    bits.push(days === 0 ? "today" : days === 1 ? "1 day" : `${days} days`);
    // The trend, and only when it actually moved: "28 -> 28" is noise.
    if (
      c.firstValue !== null &&
      c.lastValue !== null &&
      c.firstValue !== c.lastValue
    ) {
      bits.push(`${c.firstValue} -> ${c.lastValue}`);
    }
    return `- ${bits.join(" - ")}`;
  });

  // No silent truncation: a capped list that does not say it was capped reads
  // as the whole story.
  const rest = open.length - shown.length;
  if (rest > 0) lines.push(`- (+${rest} more still open)`);

  return `STILL OPEN\n${lines.join("\n")}`;
}

/**
 * Concerns belonging to ONE project, or the whole portfolio when `root` is
 * null.
 *
 * A concern with no root of its own is PORTFOLIO-LEVEL and appears only in the
 * portfolio view. That is deliberate: it is not "unattributed and therefore
 * everyone's" -- showing it under a project would assert an ownership nothing
 * established, the same rule the Docker container scoping follows.
 */
export function concernsForRoot(
  all: readonly Concern[],
  root: string | null,
): Concern[] {
  return root === null ? [...all] : all.filter((c) => c.root === root);
}
