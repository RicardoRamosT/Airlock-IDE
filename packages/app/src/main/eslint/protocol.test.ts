import { expect, it } from "vitest";
import { splitLines } from "./protocol";

// A large response reaches the pipe in several chunks; a line is only a
// message once its newline has arrived.
it("buffers partial chunks until a newline", () => {
  const feed = splitLines();
  expect(feed('{"id":1,')).toEqual([]);
  expect(feed('"messages":[]}\n{"id":2')).toEqual(['{"id":1,"messages":[]}']);
  expect(feed(',"messages":[]}\n')).toEqual(['{"id":2,"messages":[]}']);
});

it("drops blank lines", () => {
  expect(splitLines()("\n\n{}\n")).toEqual(["{}"]);
});
