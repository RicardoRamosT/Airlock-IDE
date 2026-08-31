import { expect, it } from "vitest";
import type { RootSnapshot } from "./collect";
import {
  type Concern,
  detectConcerns,
  mergeAtlasConcerns,
  reconcileConcerns,
  renderStillOpen,
  UNPUSHED_THRESHOLD,
} from "./concerns";
import type { AtlasFact } from "./facts";

const snap = (
  root: string,
  over: Partial<RootSnapshot> = {},
): RootSnapshot => ({
  root,
  missing: false,
  isRepo: true,
  branch: "main",
  upstream: "origin/main",
  ahead: 0,
  behind: 0,
  dirty: 0,
  commits: [],
  ...over,
});

const fact = (over: Partial<AtlasFact> = {}): AtlasFact => ({
  id: "f0",
  project: "Muros-Estates",
  kind: "deadline",
  value: "2026-09-15",
  verbatim: "Muros is due the 15th",
  saidAt: 1000,
  supersededAt: null,
  ...over,
});

const NOW = Date.UTC(2026, 8, 1); // 2026-09-01
const DAY = 24 * 60 * 60 * 1000;

// --- detection -------------------------------------------------------------

it("raises no-remote, carrying the commit count as its value", () => {
  // The flagship case: told to the user on every run for six days, 28 -> 44.
  const [c] = detectConcerns(
    [snap("/p/airlock", { upstream: null, ahead: 44 })],
    [],
    NOW,
  );
  expect(c?.key).toBe("/p/airlock|no-remote");
  expect(c?.source).toBe("git");
  expect(c?.value).toBe(44);
  expect(c?.title).toContain("no remote");
});

it("raises unpushed only above the threshold", () => {
  const under = detectConcerns(
    [snap("/p/a", { ahead: UNPUSHED_THRESHOLD - 1 })],
    [],
    NOW,
  );
  expect(under).toEqual([]);
  const over = detectConcerns(
    [snap("/p/a", { ahead: UNPUSHED_THRESHOLD })],
    [],
    NOW,
  );
  expect(over[0]?.key).toBe("/p/a|unpushed");
  expect(over[0]?.value).toBe(UNPUSHED_THRESHOLD);
});

it("does NOT raise a concern for uncommitted files", () => {
  // Dirty is ordinary working state, not a consequence. It would fire on every
  // project the user is actively editing -- the same false-positive class as
  // "this repo went quiet", which the user rejected during design.
  expect(detectConcerns([snap("/p/a", { dirty: 12 })], [], NOW)).toEqual([]);
});

it("does not raise no-remote AND unpushed for the same repo", () => {
  // Without an upstream there is nothing to be ahead OF; reporting both would
  // double-count one situation.
  const out = detectConcerns(
    [snap("/p/a", { upstream: null, ahead: 44 })],
    [],
    NOW,
  );
  expect(out.map((c) => c.key)).toEqual(["/p/a|no-remote"]);
});

it("raises a missing folder", () => {
  const [c] = detectConcerns([snap("/p/gone", { missing: true })], [], NOW);
  expect(c?.key).toBe("/p/gone|missing");
  expect(c?.value).toBeNull();
});

it("says nothing about a clean repository", () => {
  expect(detectConcerns([snap("/p/clean")], [], NOW)).toEqual([]);
});

it("raises a deadline as it APPROACHES, not once it is stale", () => {
  // The gap this closes: staleness.ts surfaces a fact only after 60 days of
  // AGE, so a deadline set for next week was invisible until long after it
  // passed. Nothing anywhere watched the date.
  const soon = fact({ value: "2026-09-10" }); // 9 days out
  expect(detectConcerns([], [soon], NOW).map((c) => c.source)).toEqual([
    "deadline",
  ]);
  const far = fact({ value: "2027-01-01" });
  expect(detectConcerns([], [far], NOW)).toEqual([]);
});

it("keeps raising a deadline that has already passed", () => {
  const past = fact({ value: "2026-08-01" });
  const [c] = detectConcerns([], [past], NOW);
  expect(c?.source).toBe("deadline");
  expect(c?.title).toMatch(/overdue|passed/i);
});

it("skips a deadline whose date cannot be parsed rather than guessing", () => {
  expect(detectConcerns([], [fact({ value: "soon-ish" })], NOW)).toEqual([]);
});

it("ignores a superseded fact", () => {
  const dead = fact({ value: "2026-09-10", supersededAt: 500 });
  expect(detectConcerns([], [dead], NOW)).toEqual([]);
});

it("raises a blocker once it has been open a while", () => {
  const fresh = fact({
    kind: "blocker",
    value: "waiting on the lender API",
    saidAt: NOW - DAY,
  });
  expect(detectConcerns([], [fresh], NOW)).toEqual([]);
  const old = fact({
    kind: "blocker",
    value: "waiting on the lender API",
    saidAt: NOW - 30 * DAY,
  });
  expect(detectConcerns([], [old], NOW).map((c) => c.source)).toEqual([
    "blocker",
  ]);
});

it("suppresses a project's concerns when the user has parked it", () => {
  // "ElArqui is parked" is how you tell Atlas to stop worrying, in ordinary
  // conversation. The rows keep ageing; they are only hidden.
  const parked = fact({ project: "airlock", kind: "status", value: "parked" });
  const out = detectConcerns(
    [snap("/p/airlock", { upstream: null, ahead: 44 })],
    [parked],
    NOW,
  );
  expect(out).toEqual([]);
});

it("does not treat an ordinary status fact as parked", () => {
  const active = fact({
    project: "airlock",
    kind: "status",
    value: "shipping v2",
  });
  const out = detectConcerns(
    [snap("/p/airlock", { upstream: null, ahead: 44 })],
    [active],
    NOW,
  );
  expect(out).toHaveLength(1);
});

// --- reconciliation --------------------------------------------------------

const open = (over: Partial<Concern> = {}): Concern => ({
  key: "/p/airlock|no-remote",
  source: "git",
  root: "/p/airlock",
  project: "airlock",
  title: "no remote",
  detail: "",
  firstSeenAt: NOW - 6 * DAY,
  lastSeenAt: NOW - DAY,
  firstValue: 28,
  lastValue: 41,
  resolvedAt: null,
  ...over,
});

const covered = new Set(["/p/airlock"]);

it("keeps firstSeenAt and firstValue when a concern is still true", () => {
  // These two ARE the history -- "6 days" and "28 -> 44" come from them.
  const out = reconcileConcerns(
    [open()],
    detectConcerns(
      [snap("/p/airlock", { upstream: null, ahead: 44 })],
      [],
      NOW,
    ),
    covered,
    NOW,
  );
  expect(out[0]).toMatchObject({
    firstSeenAt: NOW - 6 * DAY,
    firstValue: 28,
    lastSeenAt: NOW,
    lastValue: 44,
    resolvedAt: null,
  });
});

it("resolves a concern that is no longer true", () => {
  const out = reconcileConcerns([open()], [], covered, NOW);
  expect(out[0]?.resolvedAt).toBe(NOW);
});

it("NEVER resolves a concern whose root the collector did not cover", () => {
  // collectAll degrades: one failed git call yields no snapshot for that root.
  // Treating that as "the risk cleared" is the same "a failed read looked like
  // an absent file" bug removed from five call sites on 2026-08-30 -- and here
  // it would tell the user a danger had gone away when nothing had changed.
  const out = reconcileConcerns([open()], [], new Set(), NOW);
  expect(out[0]?.resolvedAt).toBeNull();
  expect(out[0]?.lastSeenAt).toBe(NOW - DAY); // untouched, not refreshed either
});

it("resolves a fact-derived concern by absence, since facts are read whole", () => {
  // There is no partial coverage for facts, so absence really does mean gone.
  const c = open({
    key: "Muros-Estates|deadline",
    source: "deadline",
    root: null,
    project: "Muros-Estates",
  });
  expect(reconcileConcerns([c], [], new Set(), NOW)[0]?.resolvedAt).toBe(NOW);
});

it("never auto-resolves an Atlas-raised concern", () => {
  // No detector can re-derive it, so absence proves nothing.
  const c = open({ key: "elarqui-ipv6", source: "atlas", root: null });
  expect(reconcileConcerns([c], [], new Set(), NOW)[0]?.resolvedAt).toBeNull();
});

it("adds a newly detected concern with its age starting now", () => {
  const out = reconcileConcerns(
    [],
    detectConcerns([snap("/p/new", { upstream: null, ahead: 3 })], [], NOW),
    new Set(["/p/new"]),
    NOW,
  );
  expect(out[0]).toMatchObject({
    firstSeenAt: NOW,
    lastSeenAt: NOW,
    firstValue: 3,
    lastValue: 3,
    resolvedAt: null,
  });
});

it("reopens a resolved concern with a FRESH age, not the old one", () => {
  // "How long has this been true" means this time, not cumulatively.
  const was = open({ resolvedAt: NOW - 2 * DAY, firstSeenAt: NOW - 40 * DAY });
  const out = reconcileConcerns(
    [was],
    detectConcerns([snap("/p/airlock", { upstream: null, ahead: 2 })], [], NOW),
    covered,
    NOW,
  );
  expect(out[0]?.resolvedAt).toBeNull();
  expect(out[0]?.firstSeenAt).toBe(NOW);
  expect(out[0]?.firstValue).toBe(2);
});

it("keeps resolved concerns rather than dropping them", () => {
  // Nothing is ever deleted, matching facts.ts: "was this ever a problem?" has
  // to have an answer.
  const out = reconcileConcerns(
    [open({ resolvedAt: NOW - DAY })],
    [],
    covered,
    NOW,
  );
  expect(out).toHaveLength(1);
});

// --- rendering -------------------------------------------------------------

it("renders a standing concern with its age and, when it moved, its trend", () => {
  const out = renderStillOpen([open()], NOW);
  expect(out).toContain("STILL OPEN");
  expect(out).toContain("airlock");
  expect(out).toContain("6 days");
  expect(out).toContain("28 -> 41");
});

it("omits a trend that has not actually moved", () => {
  // "28 -> 28" is noise dressed as information.
  const out = renderStillOpen([open({ firstValue: 28, lastValue: 28 })], NOW);
  expect(out).not.toContain("->");
});

it("omits a trend entirely for a concern that cannot be measured", () => {
  const out = renderStillOpen(
    [open({ source: "atlas", firstValue: null, lastValue: null })],
    NOW,
  );
  expect(out).not.toContain("->");
});

it("says nothing at all when nothing is open", () => {
  expect(renderStillOpen([], NOW)).toBe("");
  expect(renderStillOpen([open({ resolvedAt: NOW })], NOW)).toBe("");
});

it("puts the soonest clock first", () => {
  const out = renderStillOpen(
    [open(), open({ key: "k2", source: "deadline", title: "due in 3d" })],
    NOW,
  );
  expect(out.indexOf("due in 3d")).toBeLessThan(out.indexOf("no remote"));
});

it("says how many it did not show rather than truncating silently", () => {
  const many = Array.from({ length: 12 }, (_, i) =>
    open({ key: `k${i}`, project: `p${i}` }),
  );
  const out = renderStillOpen(many, NOW);
  expect(out).toContain("+4 more");
});

// --- Atlas-raised ----------------------------------------------------------

it("adds a concern Atlas raised, with age but never a trend", () => {
  // A model-raised concern cannot be re-measured: a rephrase tomorrow is a
  // different string. Inventing a trend from two model utterances would be the
  // confident-wrong-number this whole design exists to avoid.
  const out = mergeAtlasConcerns(
    [],
    [
      {
        key: "elarqui-ipv6",
        project: "ElArqui",
        title: "apex still answers on IPv6",
        detail: "Render is IPv4 only.",
      },
    ],
    NOW,
  );
  expect(out[0]).toMatchObject({
    key: "elarqui-ipv6",
    source: "atlas",
    root: null,
    firstSeenAt: NOW,
    firstValue: null,
    lastValue: null,
    resolvedAt: null,
  });
});

it("reuses an existing key instead of duplicating, keeping the age", () => {
  const was = open({ key: "elarqui-ipv6", source: "atlas", root: null });
  const out = mergeAtlasConcerns(
    [was],
    [
      {
        key: "elarqui-ipv6",
        project: "ElArqui",
        title: "reworded",
        detail: "d",
      },
    ],
    NOW,
  );
  expect(out).toHaveLength(1);
  expect(out[0]?.firstSeenAt).toBe(was.firstSeenAt); // the history survived
  expect(out[0]?.title).toBe("reworded");
});

it("lets Atlas close a concern it raised", () => {
  const was = open({ key: "elarqui-ipv6", source: "atlas", root: null });
  const out = mergeAtlasConcerns(
    [was],
    [
      {
        key: "elarqui-ipv6",
        project: null,
        title: "t",
        detail: "d",
        resolved: true,
      },
    ],
    NOW,
  );
  expect(out[0]?.resolvedAt).toBe(NOW);
});

it("REFUSES to let Atlas touch a measured concern", () => {
  // The boundary that matters. git/deadline/blocker concerns are derived from
  // signals, and a model claiming "no-remote is resolved" would clear a real
  // warning that nothing had actually fixed -- it would simply be re-raised on
  // the next refresh, but the user would have been told a danger had passed.
  const measured = open(); // source: "git"
  const out = mergeAtlasConcerns(
    [measured],
    [
      {
        key: measured.key,
        project: "airlock",
        title: "actually this is fine",
        detail: "",
        resolved: true,
      },
    ],
    NOW,
  );
  expect(out).toHaveLength(1);
  expect(out[0]).toEqual(measured); // untouched, byte for byte
});

it("ignores a resolve for a concern that does not exist", () => {
  expect(
    mergeAtlasConcerns(
      [],
      [{ key: "nope", project: null, title: "t", detail: "d", resolved: true }],
      NOW,
    ),
  ).toEqual([]);
});

it("reopens an Atlas concern with a fresh age", () => {
  const was = open({
    key: "k",
    source: "atlas",
    root: null,
    resolvedAt: NOW - DAY,
    firstSeenAt: NOW - 40 * DAY,
  });
  const out = mergeAtlasConcerns(
    [was],
    [{ key: "k", project: null, title: "back", detail: "d" }],
    NOW,
  );
  expect(out[0]?.resolvedAt).toBeNull();
  expect(out[0]?.firstSeenAt).toBe(NOW);
});
