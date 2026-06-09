import { describe, expect, it } from "vitest";
import { parseConnString, redactConnStrings } from "./connstr";

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

describe("redactConnStrings", () => {
  it("redacts user:pw in a postgres url", () => {
    expect(redactConnStrings("postgres://user:pw@host/db")).toBe(
      "postgres://***@host/db",
    );
  });

  it("redacts user:pw in a postgresql url with no path", () => {
    expect(redactConnStrings("postgresql://user:pw@host")).toBe(
      "postgresql://***@host",
    );
  });

  it("redacts a connstr embedded mid-message", () => {
    expect(
      redactConnStrings("connect ECONNREFUSED postgres://u:p@h:5432"),
    ).toBe("connect ECONNREFUSED postgres://***@h:5432");
  });

  it("redacts multiple occurrences in one string", () => {
    expect(
      redactConnStrings(
        "failover from postgres://a:1@h1/db to postgres://b:2@h2/db",
      ),
    ).toBe("failover from postgres://***@h1/db to postgres://***@h2/db");
  });

  it("redacts any scheme, not just postgres", () => {
    expect(redactConnStrings("redis://user:pw@cache:6379")).toBe(
      "redis://***@cache:6379",
    );
    expect(redactConnStrings("mongodb+srv://user:pw@cluster")).toBe(
      "mongodb+srv://***@cluster",
    );
  });

  it("leaves a url with no userinfo unchanged", () => {
    expect(redactConnStrings("postgres://host/db")).toBe("postgres://host/db");
  });

  it("leaves text with no url unchanged", () => {
    expect(redactConnStrings("connection timed out after 5000ms")).toBe(
      "connection timed out after 5000ms",
    );
  });

  it("handles user-only and password-only userinfo", () => {
    expect(redactConnStrings("postgres://justuser@host/db")).toBe(
      "postgres://***@host/db",
    );
    expect(redactConnStrings("postgres://:justpw@host/db")).toBe(
      "postgres://***@host/db",
    );
  });

  it("neutralizes a realistic leaky pg error message (leak fixture)", () => {
    // Simulates a future pg upgrade / DNS error echoing the full connstr.
    const leaky =
      "connect ECONNREFUSED postgres://neondb_owner:npg_SECRETvalue@ep-foo.aws.neon.tech/db";
    const scrubbed = redactConnStrings(leaky);
    expect(scrubbed).not.toContain("npg_SECRETvalue");
    expect(scrubbed).not.toContain(":npg_");
    expect(scrubbed).not.toContain("neondb_owner:");
    expect(scrubbed).toBe(
      "connect ECONNREFUSED postgres://***@ep-foo.aws.neon.tech/db",
    );
  });

  // C5: a password containing a raw @ must be FULLY redacted. The userinfo/host
  // split is the LAST @ (RFC 3986 / Postgres); stopping at the first @ left the
  // tail exposed ("postgres://***@ss@host/db" still leaks "ss@host").
  it("redacts a password that contains a raw @ (splits at the last @)", () => {
    const out = redactConnStrings("postgres://user:p@ss@host/db");
    expect(out).toBe("postgres://***@host/db");
    expect(out).not.toContain("p@ss");
    expect(out).not.toContain("ss@host");
  });

  // H5: a long line with no connstr must not trigger catastrophic O(n^2)
  // backtracking. The old unbounded scheme run hung the main process ~97s on
  // ~400k chars; with the bounded runs this returns immediately. On the old
  // regex this test exceeds the default timeout and fails.
  it("does not hang on a long non-matching line (bounded backtracking)", () => {
    const long = "a".repeat(300_000);
    expect(redactConnStrings(long)).toBe(long);
  });
});
