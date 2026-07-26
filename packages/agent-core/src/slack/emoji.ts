// packages/agent-core/src/slack/emoji.ts
// Slack's Web API returns emoji as :shortcode: text -- its own client maps them
// to Unicode at render time. Without this the transcript shows a literal
// ":slightly_smiling_face:" where Slack shows 🙂.
//
// Pure and dependency-free, applied in the SHARED read path so the agent sees
// the emoji too rather than a shortcode it would have to decode.
//
// Coverage is Slack's FULL table (see emojiData.ts). What still cannot be
// mapped is workspace CUSTOM emoji (:my_team_logo:): those are images served
// from Slack with no Unicode equivalent, so the shortcode is left exactly as it
// arrived -- honest, and it keeps the information rather than dropping it.
import { EMOJI_TABLE } from "./emojiData";

// Built once on first use: ~1900 records, ~1970 names including aliases.
let table: Map<string, string> | null = null;

function lookup(): Map<string, string> {
  if (table) return table;
  const m = new Map<string, string>();
  for (const record of EMOJI_TABLE.split(" ")) {
    const eq = record.lastIndexOf("=");
    if (eq < 1) continue;
    const char = String.fromCodePoint(
      ...record
        .slice(eq + 1)
        .split("-")
        .map((cp) => Number.parseInt(cp, 16)),
    );
    for (const name of record.slice(0, eq).split(",")) m.set(name, char);
  }
  table = m;
  return m;
}

// A shortcode is [a-z0-9_+-] between colons. Anchoring on that character class
// (rather than "anything between colons") is what keeps times and ratios --
// "15:49", "3:1" -- from being mangled.
const SHORTCODE = /:([a-z0-9_+-]+):/g;
// Slack appends skin tone as its own trailing shortcode: ":+1::skin-tone-4:".
const SKIN_TONE = /:skin-tone-\d+:/g;

export function renderEmoji(text: string): string {
  if (!text.includes(":")) return text;
  const m = lookup();
  return text
    .replace(SKIN_TONE, "")
    .replace(SHORTCODE, (whole, name: string) => m.get(name) ?? whole);
}
