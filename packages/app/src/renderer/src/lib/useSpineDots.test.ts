import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(here, "useSpineDots.ts"), "utf8");

describe("the spine seeds as well as subscribes", () => {
  // THE BUG THIS EXISTS FOR: the hook only subscribed. Main broadcasts its
  // first dots at startup, BEFORE any renderer has mounted and subscribed, so
  // the strip stayed empty until the next local tick -- it appeared a full
  // minute after launch, and again after every renderer reload.
  //
  // A push channel alone is half a contract. The agent-request surface already
  // documents the other half: "the renderer takes a snapshot on mount and
  // subscribes -- the snapshot is the half that survives a reload."
  it("takes a snapshot on mount, not only a subscription", () => {
    expect(src).toContain("onAtlasSpine");
    expect(
      src.includes("atlasSpine("),
      "useSpineDots subscribes but never seeds: the strip will be empty until the first tick after mount",
    ).toBe(true);
  });
});
