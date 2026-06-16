import { describe, expect, it } from "vitest";
import { isLikelyPostgresUrl, isValidSecretName } from "./dbConnect";

describe("isLikelyPostgresUrl", () => {
  it("accepts postgres:// and postgresql:// URLs with a host", () => {
    expect(isLikelyPostgresUrl("postgres://u:p@host/db")).toBe(true);
    expect(isLikelyPostgresUrl("postgresql://u:p@host:5432/db")).toBe(true);
    expect(isLikelyPostgresUrl("postgresql://host/db")).toBe(true); // no creds
    expect(
      isLikelyPostgresUrl("  postgresql://u:p@ep-x.neon.tech/neondb  "),
    ).toBe(true); // trimmed
  });

  it("rejects a Neon API key, missing host, wrong scheme, and junk", () => {
    expect(isLikelyPostgresUrl("napi_abc123def456")).toBe(false);
    expect(isLikelyPostgresUrl("postgresql:///db")).toBe(false); // no host
    expect(isLikelyPostgresUrl("https://example.com")).toBe(false);
    expect(isLikelyPostgresUrl("not a url")).toBe(false);
    expect(isLikelyPostgresUrl("")).toBe(false);
  });
});

describe("isValidSecretName", () => {
  it("accepts env-style identifiers", () => {
    expect(isValidSecretName("DATABASE_URL")).toBe(true);
    expect(isValidSecretName("_x")).toBe(true);
    expect(isValidSecretName("Db2")).toBe(true);
  });

  it("rejects empty, leading digit, and illegal chars", () => {
    expect(isValidSecretName("")).toBe(false);
    expect(isValidSecretName("2DB")).toBe(false);
    expect(isValidSecretName("MY-DB")).toBe(false);
    expect(isValidSecretName("a b")).toBe(false);
  });
});
