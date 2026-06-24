// packages/agent-core/src/integrations/map.ts
import { evalExpr } from "./expr";
import type {
  ActionSpec,
  IntegrationItem,
  IntegrationManifest,
  IntegrationState,
  ItemAction,
  ItemDetail,
  StateSpec,
} from "./manifest";

const str = (v: unknown): string =>
  typeof v === "string" ? v : v == null ? "" : String(v);

// POSIX single-quote escaping: wrap in single quotes and turn any embedded
// quote into '\''. Everything inside '...' is literal, so a polled value (a
// resource name from the CLI's JSON) can never inject shell syntax into a
// command-kind action.
const shellQuote = (v: string): string => `'${v.replace(/'/g, "'\\''")}'`;

// Resolve an action template by substituting {{$.path}} placeholders against
// the raw item. command-kind values are shell-quoted; url-kind values are raw.
// Returns null if any placeholder resolves empty (a broken command/url is worse
// than a missing button).
function resolveAction(spec: ActionSpec, item: unknown): ItemAction | null {
  let ok = true;
  const target = spec.template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, expr) => {
    const raw = str(evalExpr(item, expr));
    if (raw === "") ok = false;
    return spec.kind === "command" ? shellQuote(raw) : raw;
  });
  if (!ok) return null;
  return {
    label: spec.label,
    icon: spec.icon,
    kind: spec.kind,
    target,
    ...(spec.when ? { when: spec.when } : {}),
  };
}

export function applyState(spec: StateSpec, item: unknown): IntegrationState {
  const v = str(evalExpr(item, spec.from));
  if (spec.running?.includes(v)) return "running";
  if (spec.done?.includes(v)) return "done";
  if (spec.failed?.includes(v)) return "failed";
  return spec.default ?? "idle";
}

// Pure: raw probe JSON -> the items worth surfacing. `show` defaults to the
// transitional/needs-attention states, matching the existing Render rule that
// a finished/steady operation is not "activity".
export function mapToItems(
  m: IntegrationManifest,
  json: unknown,
): IntegrationItem[] {
  const map = m.map;
  const raw = map.items ? evalExpr(json, map.items) : [json];
  const list = Array.isArray(raw) ? raw : [];
  const show = map.show ?? ["running", "failed"];
  const out: IntegrationItem[] = [];
  for (const it of list) {
    const state = applyState(map.state, it);
    if (!show.includes(state)) continue;
    const title = str(evalExpr(it, map.title));
    const key = map.key ? str(evalExpr(it, map.key)) : title;
    const href = map.href ? str(evalExpr(it, map.href)) : "";
    const details: ItemDetail[] | undefined = map.details
      ?.map((d) => ({ label: d.label, value: str(evalExpr(it, d.value)) }))
      .filter((d) => d.value !== "");
    const actions = map.actions
      ?.map((a) => resolveAction(a, it))
      .filter((a): a is ItemAction => a !== null);
    out.push({
      id: `int:${m.id}:${key}`,
      title,
      subtitle: map.subtitle ? str(evalExpr(it, map.subtitle)) : "",
      state,
      ...(href ? { href } : {}),
      ...(details && details.length ? { details } : {}),
      ...(actions && actions.length ? { actions } : {}),
    });
  }
  return out;
}
