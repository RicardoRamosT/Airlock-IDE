import { redactConnStrings } from "../db/connstr";
import { redactSecrets } from "../redact/redact";

// Defense-in-depth: scrub injected secret values and connection strings out of
// an event's detail/error before it is persisted. The primary guarantee is that
// callers log identifiers, not values; this is the safety net that also makes
// the agent-facing read tool safe.
export function redactEvent<
  T extends {
    detail?: Record<string, unknown>;
    error?: { message: string; stack?: string };
  },
>(event: T, secretValues: string[] = []): T {
  const scrub = (text: string): string =>
    redactConnStrings(redactSecrets(text, secretValues));

  let detail = event.detail;
  if (detail) {
    const scrubbed = scrub(JSON.stringify(detail));
    try {
      detail = JSON.parse(scrubbed) as Record<string, unknown>;
    } catch {
      // A replacement token broke JSON shape (rare): keep a redacted string.
      detail = { redacted: scrubbed };
    }
  }

  const error = event.error
    ? {
        message: scrub(event.error.message),
        stack: event.error.stack ? scrub(event.error.stack) : undefined,
      }
    : event.error;

  return { ...event, detail, error };
}
