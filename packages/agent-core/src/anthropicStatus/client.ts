import {
  type AnthropicIndicator,
  type ParsedAnthropicStatus,
  parseAnthropicStatus,
} from "./parse";

export type { AnthropicIndicator, ParsedAnthropicStatus };

const STATUS_URL = "https://status.anthropic.com/api/v2/status.json";

// DI transport so the HTTP edge is swappable in tests (mirrors render/client).
export interface AnthropicStatusTransport {
  get(url: string): Promise<unknown>;
}
export interface AnthropicStatusOptions {
  transport?: AnthropicStatusTransport;
}

export const anthropicStatusFetchTransport: AnthropicStatusTransport = {
  async get(url) {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok)
      throw new Error(`Anthropic status ${res.status} ${res.statusText}`);
    return res.json();
  },
};

export async function fetchAnthropicStatus(
  opts: AnthropicStatusOptions = {},
): Promise<ParsedAnthropicStatus> {
  const t = opts.transport ?? anthropicStatusFetchTransport;
  return parseAnthropicStatus(await t.get(STATUS_URL));
}
