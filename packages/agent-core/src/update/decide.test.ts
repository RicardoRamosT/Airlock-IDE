import { describe, expect, it } from "vitest";
import { chooseUpdateAction } from "./decide";

describe("chooseUpdateAction", () => {
  it("swaps when the install dir is writable, else reveals", () => {
    expect(chooseUpdateAction({ installDirWritable: true })).toBe("swap");
    expect(chooseUpdateAction({ installDirWritable: false })).toBe("reveal");
  });
});
