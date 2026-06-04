export interface ValidationResult {
  provider: string | null;
  valid: boolean;
  hint: string | null;
}

interface ProviderPattern {
  provider: string;
  pattern: RegExp;
  hint: string | null;
}

const PROVIDERS: ProviderPattern[] = [
  {
    provider: "stripe-secret",
    pattern: /^sk_(live|test)_[A-Za-z0-9]{16,}$/,
    hint: "Stripe secret key",
  },
  {
    provider: "stripe-publishable",
    pattern: /^pk_(live|test)_[A-Za-z0-9]{16,}$/,
    hint: "Stripe publishable key - this one is public, not secret",
  },
  {
    provider: "aws-access-key-id",
    pattern: /^(AKIA|ASIA)[A-Z0-9]{16}$/,
    hint: "AWS access key ID",
  },
  {
    provider: "github-token",
    pattern: /^gh[pousr]_[A-Za-z0-9]{36,}$/,
    hint: "GitHub token",
  },
  {
    provider: "slack-token",
    pattern: /^xox[bpars]-[A-Za-z0-9-]{10,}$/,
    hint: "Slack token",
  },
  {
    provider: "anthropic-api-key",
    pattern: /^sk-ant-[A-Za-z0-9_-]{20,}$/,
    hint: "Anthropic API key",
  },
  {
    provider: "postgres-url",
    pattern: /^postgres(ql)?:\/\/[^:@\s]+:[^@\s]+@.+/,
    hint: "Postgres connection URL with embedded credentials",
  },
  {
    provider: "pem-private-key",
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    hint: "PEM private key block",
  },
  {
    provider: "jwt",
    pattern: /^eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/,
    hint: "JSON Web Token",
  },
];

export function validateSecretName(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

export function validateSecret(name: string, value: string): ValidationResult {
  const v = value.trim();
  if (v.length === 0)
    return { provider: null, valid: false, hint: "Value is empty" };

  for (const p of PROVIDERS) {
    if (p.pattern.test(v))
      return { provider: p.provider, valid: true, hint: p.hint };
  }

  // Name-promises-format mismatches the patterns above did not catch.
  if (/STRIPE_SECRET/i.test(name) && !v.startsWith("sk_")) {
    return {
      provider: "stripe-secret",
      valid: false,
      hint: "Name suggests a Stripe secret key, but the value does not start with sk_",
    };
  }
  if (/^AWS_SECRET/i.test(name) && v.length !== 40) {
    return {
      provider: "aws-secret-access-key",
      valid: false,
      hint: "AWS secret access keys are exactly 40 characters",
    };
  }

  return { provider: null, valid: true, hint: null };
}
