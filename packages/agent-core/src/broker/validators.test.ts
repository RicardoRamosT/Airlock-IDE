import { describe, expect, it } from "vitest";
import { validateSecret, validateSecretName } from "./validators";

describe("validateSecretName", () => {
  it.each([
    "DATABASE_URL",
    "STRIPE_SECRET_KEY",
    "_X",
    "a1",
  ])("accepts %s", (n) => {
    expect(validateSecretName(n)).toBe(true);
  });
  it.each(["1BAD", "WITH SPACE", "DASH-ED", ""])("rejects %s", (n) => {
    expect(validateSecretName(n)).toBe(false);
  });
});

describe("validateSecret", () => {
  it("detects Stripe secret keys", () => {
    const r = validateSecret(
      "STRIPE_SECRET_KEY",
      "sk_test_4eC39HqLyjWDarjtT1zdp7dc",
    );
    expect(r.provider).toBe("stripe-secret");
    expect(r.valid).toBe(true);
  });

  it("flags a publishable key as public", () => {
    const r = validateSecret("STRIPE_KEY", "pk_test_TYooMQauvdEDq54NiTphI7jx");
    expect(r.provider).toBe("stripe-publishable");
    expect(r.valid).toBe(true);
    expect(r.hint).toMatch(/public/i);
  });

  it("detects AWS access key ids", () => {
    expect(
      validateSecret("AWS_ACCESS_KEY_ID", "AKIAIOSFODNN7EXAMPLE").provider,
    ).toBe("aws-access-key-id");
  });

  it("detects GitHub tokens", () => {
    const r = validateSecret("GH", `ghp_${"a".repeat(36)}`);
    expect(r.provider).toBe("github-token");
  });

  it("detects postgres URLs with credentials", () => {
    const r = validateSecret(
      "DATABASE_URL",
      "postgresql://user:pass@host:5432/db",
    );
    expect(r.provider).toBe("postgres-url");
    expect(r.valid).toBe(true);
  });

  it("detects PEM private key blocks", () => {
    const pem =
      "-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----";
    expect(validateSecret("SNOWFLAKE_KEY", pem).provider).toBe(
      "pem-private-key",
    );
  });

  it("detects JWTs", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.dQw4w9WgXcQ";
    expect(validateSecret("TOKEN", jwt).provider).toBe("jwt");
  });

  it("detects Anthropic keys", () => {
    expect(
      validateSecret("ANTHROPIC_API_KEY", `sk-ant-${"x".repeat(24)}`).provider,
    ).toBe("anthropic-api-key");
  });

  it("warns when the name promises Stripe but the value does not", () => {
    const r = validateSecret("STRIPE_SECRET_KEY", "not-a-stripe-key");
    expect(r.valid).toBe(false);
    expect(r.hint).toMatch(/sk_/);
  });

  it("rejects empty values", () => {
    expect(validateSecret("X", "  ").valid).toBe(false);
  });

  it("accepts unknown formats as valid with no provider", () => {
    const r = validateSecret("MY_CUSTOM_TOKEN", "whatever-opaque-string");
    expect(r).toEqual({ provider: null, valid: true, hint: null });
  });
});
