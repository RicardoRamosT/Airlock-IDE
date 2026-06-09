import { expect, it } from "vitest";
import { ensureCommitIdentity } from "./identity";

function fakeRun(current: Record<string, string>) {
  const calls: string[][] = [];
  const run = async (_root: string, args: string[]) => {
    calls.push(args);
    if (args[0] === "config" && args[1] === "--local" && args.length === 3) {
      return current[args[2] as string] ?? ""; // a read
    }
    return ""; // a write
  };
  return { run, calls };
}

it("writes name and email when they differ", async () => {
  const { run, calls } = fakeRun({ "user.name": "Old", "user.email": "old@x" });
  await ensureCommitIdentity("/r", { name: "New", email: "new@x" }, run);
  expect(calls).toContainEqual(["config", "--local", "user.name", "New"]);
  expect(calls).toContainEqual(["config", "--local", "user.email", "new@x"]);
});

it("writes nothing when identity already matches", async () => {
  const { run, calls } = fakeRun({ "user.name": "Same", "user.email": "s@x" });
  await ensureCommitIdentity("/r", { name: "Same", email: "s@x" }, run);
  const writes = calls.filter((c) => c.length === 5);
  expect(writes).toEqual([]);
});
