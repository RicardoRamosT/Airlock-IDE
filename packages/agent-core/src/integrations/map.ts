// packages/agent-core/src/integrations/map.ts
import { evalExpr } from "./expr";
import type {
  IntegrationItem,
  IntegrationManifest,
  IntegrationState,
  StateSpec,
} from "./manifest";

const str = (v: unknown): string =>
  typeof v === "string" ? v : v == null ? "" : String(v);

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
    out.push({
      id: `int:${m.id}:${key}`,
      title,
      subtitle: map.subtitle ? str(evalExpr(it, map.subtitle)) : "",
      state,
      ...(href ? { href } : {}),
    });
  }
  return out;
}
