import { expect, it } from "vitest";
import { isIgnored } from "./fsWatch";

it("ignores the committed order file (no re-list churn on write)", () => {
  expect(isIgnored("/proj/.airlock-order.json")).toBe(true);
  // The atomic-write temp file must also be ignored, so the brief tmp -> rename
  // never fires a stray add (belt-and-suspenders vs awaitWriteFinish).
  expect(isIgnored("/proj/.airlock-order.json.tmp")).toBe(true);
});
it("ignores the vault and VCS/build dirs", () => {
  expect(isIgnored("/proj/.airlock/names.json")).toBe(true);
  expect(isIgnored("/proj/node_modules/x/index.js")).toBe(true);
});
it("ignores .claude agent infra (worktrees/transcripts) — the EMFILE fd-exhaustion fix", () => {
  expect(isIgnored("/proj/.claude")).toBe(true);
  expect(
    isIgnored("/proj/.claude/worktrees/pr-132/backend/sql/seed/x.sql"),
  ).toBe(true);
});
it("ignores dependency/cache dirs that exhaust file descriptors", () => {
  // pdfextractor's Python venv (~12.5k files) was the EMFILE trigger.
  expect(
    isIgnored("/proj/server_py/venv/lib/python3.14/site-packages/x.py"),
  ).toBe(true);
  expect(isIgnored("/proj/.venv/bin/python")).toBe(true);
  expect(isIgnored("/proj/app/__pycache__/mod.cpython-314.pyc")).toBe(true);
  expect(isIgnored("/proj/rust/target/debug/x")).toBe(true);
  expect(isIgnored("/proj/web/.next/cache/y")).toBe(true);
});
it("does not ignore ordinary source files", () => {
  expect(isIgnored("/proj/src/app.ts")).toBe(false);
  // A non-dot 'claude' segment is a real source dir, not the agent vault.
  expect(isIgnored("/proj/src/claude/client.ts")).toBe(false);
  // Bare 'env' is too ambiguous to ignore (often a real config dir).
  expect(isIgnored("/proj/env/config.ts")).toBe(false);
});
