import { expect, it } from "vitest";
import {
  type AtlasFact,
  factKey,
  type IncomingFact,
  liveFacts,
  mergeFacts,
} from "./facts";

const seq = (n: number) => `f${n}`;

const inc = (over: Partial<IncomingFact> = {}): IncomingFact => ({
  project: "Muros-Estates",
  kind: "deadline",
  value: "2026-09-15",
  verbatim: "Muros is due the 15th",
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

it("keys a fact by project and kind, so one project has one deadline", () => {
  expect(factKey({ project: "A", kind: "deadline" })).toBe(
    factKey({ project: "A", kind: "deadline" }),
  );
  expect(factKey({ project: "A", kind: "deadline" })).not.toBe(
    factKey({ project: "A", kind: "priority" }),
  );
  expect(factKey({ project: null, kind: "note" })).not.toBe(
    factKey({ project: "A", kind: "note" }),
  );
});

it("adds a new fact with the verbatim sentence that produced it", () => {
  const out = mergeFacts([], [inc()], 5000, seq);
  expect(out).toHaveLength(1);
  expect(out[0]).toMatchObject({
    project: "Muros-Estates",
    kind: "deadline",
    value: "2026-09-15",
    verbatim: "Muros is due the 15th",
    saidAt: 5000,
    supersededAt: null,
  });
});

it("supersedes an older fact of the same project and kind, and KEEPS it", () => {
  // Never silently deleted: the user must be able to ask "why do you think
  // that?" and see the sentence they actually said.
  const out = mergeFacts(
    [fact()],
    [inc({ value: "2026-10-01", verbatim: "Muros moved to October" })],
    9000,
    seq,
  );
  expect(out).toHaveLength(2);
  const old = out.find((f) => f.value === "2026-09-15");
  expect(old?.supersededAt).toBe(9000);
  expect(old?.verbatim).toBe("Muros is due the 15th");
  const now = out.find((f) => f.value === "2026-10-01");
  expect(now?.supersededAt).toBeNull();
});

it("does not supersede a fact of a different kind for the same project", () => {
  const out = mergeFacts(
    [fact()],
    [inc({ kind: "priority", value: "high" })],
    9000,
    seq,
  );
  expect(out.filter((f) => f.supersededAt === null)).toHaveLength(2);
});

it("does not supersede the same kind on a different project", () => {
  const out = mergeFacts([fact()], [inc({ project: "ElArqui" })], 9000, seq);
  expect(out.filter((f) => f.supersededAt === null)).toHaveLength(2);
});

it("ignores an incoming fact with a blank value", () => {
  const out = mergeFacts([], [inc({ value: "  " })], 5000, seq);
  expect(out).toEqual([]);
});

it("applies several incoming facts in order, the last winning per key", () => {
  const out = mergeFacts(
    [],
    [inc({ value: "first" }), inc({ value: "second" })],
    5000,
    seq,
  );
  expect(liveFacts(out)).toHaveLength(1);
  expect(liveFacts(out)[0]?.value).toBe("second");
});

it("liveFacts returns only what is still believed", () => {
  const out = liveFacts([fact(), fact({ id: "f9", supersededAt: 9000 })]);
  expect(out).toHaveLength(1);
  expect(out[0]?.id).toBe("f0");
});
