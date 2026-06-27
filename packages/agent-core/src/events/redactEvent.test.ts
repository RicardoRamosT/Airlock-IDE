import { describe, expect, it } from "vitest";
import { redactEvent } from "./redactEvent";

describe("redactEvent", () => {
  it("scrubs a known injected secret value from detail (moat test)", () => {
    const out = redactEvent({ detail: { note: "token is SECRET123 ok" } }, [
      "SECRET123",
    ]);
    expect(JSON.stringify(out.detail)).not.toContain("SECRET123");
  });

  it("scrubs connection-string passwords from detail", () => {
    const out = redactEvent({
      detail: { url: "postgres://u:p4ss@h:5432/db" },
    });
    expect(JSON.stringify(out.detail)).not.toContain("p4ss");
  });

  it("scrubs the error message + stack", () => {
    const out = redactEvent(
      {
        error: {
          message: "failed with SECRET123",
          stack: "at x SECRET123",
        },
      },
      ["SECRET123"],
    );
    expect(out.error?.message).not.toContain("SECRET123");
    expect(out.error?.stack).not.toContain("SECRET123");
  });

  it("leaves an event with no detail/error unchanged", () => {
    const e = { op: "x" } as {
      op: string;
      detail?: Record<string, unknown>;
    };
    expect(redactEvent(e)).toEqual(e);
  });
});
