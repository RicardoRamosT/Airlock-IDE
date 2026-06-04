import { describe, expect, it } from "vitest";
import { parseConnString } from "./connstr";

describe("parseConnString", () => {
  it("parses a neon-style postgres url and redacts the password", () => {
    const r = parseConnString(
      "postgresql://alice:s3cret@ep-cool-1.us-east-2.aws.neon.tech/neondb?sslmode=require",
    );
    expect(r).toEqual({
      host: "ep-cool-1.us-east-2.aws.neon.tech",
      port: 5432,
      database: "neondb",
      user: "alice",
      redacted:
        "postgresql://alice:***@ep-cool-1.us-east-2.aws.neon.tech/neondb",
    });
  });

  it("keeps an explicit port", () => {
    const r = parseConnString("postgres://u:p@localhost:6543/app");
    expect(r?.port).toBe(6543);
    expect(r?.redacted).toBe("postgres://u:***@localhost:6543/app");
  });

  it("returns null for non-postgres or junk", () => {
    expect(parseConnString("mysql://u:p@h/db")).toBeNull();
    expect(parseConnString("not a url")).toBeNull();
    expect(parseConnString("https://example.com")).toBeNull();
  });

  it("handles a missing password (no leak, no crash)", () => {
    const r = parseConnString("postgres://u@localhost/app");
    expect(r?.user).toBe("u");
    expect(r?.redacted).toBe("postgres://u:***@localhost/app");
  });
});
