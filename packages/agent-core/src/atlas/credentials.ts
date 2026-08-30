// ASCII comments only. Which credential pays for a `claude` call.
//
// This exists because Atlas ships to other people. On the author's machine no
// key is set and the subscription pays, so the daily debrief costs quota and
// nothing else. A user with ANTHROPIC_API_KEY exported gets the SAME call
// billed in real money. Spending an unknown user's money silently is the one
// mistake that cannot be apologised for afterwards, so Atlas asks first and
// says which kind of cost it means.

export type CredentialMode = "api-key" | "auth-token" | "subscription";

function present(v: string | undefined): boolean {
  return typeof v === "string" && v.trim().length > 0;
}

// Mirrors the CLI's own resolution order: API key, then auth token, then the
// OAuth profile on disk. An exported-but-empty var is a common shell accident
// and counts as unset.
export function detectCredentialMode(
  env: Record<string, string | undefined>,
): CredentialMode {
  if (present(env.ANTHROPIC_API_KEY)) return "api-key";
  if (present(env.ANTHROPIC_AUTH_TOKEN)) return "auth-token";
  return "subscription";
}

// The wording shown in the first-run opt-in. Money for API users, quota for
// plan users -- never the wrong currency for the wrong person.
export function costDisclosure(mode: CredentialMode): string {
  if (mode === "subscription") {
    return "Atlas writes one summary a day using your Claude plan. It uses a small amount of your usage quota and never runs on a timer.";
  }
  return "An Anthropic API credential is set on this machine, so Atlas will bill your API account for each summary it writes -- roughly one short request a day.";
}
