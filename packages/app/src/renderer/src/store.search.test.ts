import { afterEach, beforeEach, expect, it } from "vitest";
import { useApp } from "./store";

const initialState = useApp.getState();
beforeEach(() => useApp.setState(initialState, true));
afterEach(() => useApp.setState(initialState, true));

it("setSearchOpen toggles, setSearchResults stores query+results", () => {
  const s = useApp.getState();
  expect(s.searchOpen).toBe(false);
  s.setSearchOpen(true);
  expect(useApp.getState().searchOpen).toBe(true);
  const results = { files: [{ path: "a.ts", matches: [] }], truncated: false };
  s.setSearchResults("hello", results);
  expect(useApp.getState().search).toEqual({ query: "hello", results });
});

it("revealLine sets reveal with an incrementing nonce", () => {
  const s = useApp.getState();
  expect(s.reveal).toBeNull();
  s.revealLine("t1", "a.ts", 5);
  const first = useApp.getState().reveal;
  expect(first).toMatchObject({ tabId: "t1", path: "a.ts", line: 5 });
  s.revealLine("t1", "a.ts", 5);
  expect(useApp.getState().reveal?.nonce).toBe((first?.nonce ?? 0) + 1);
});
