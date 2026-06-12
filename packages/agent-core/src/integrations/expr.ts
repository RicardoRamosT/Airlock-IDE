// A deliberately tiny JSONPath subset for integration manifests: field access
// ($.a.b), array indexing ($.a[0]), and .length on arrays/strings. Anything
// beyond this is the signal to use a customParser, not to grow the language.
// Pure + total: a missing path yields undefined, never throws. ASCII-only
// comments (this package is CJS-bundled into the Electron main process).
export function evalExpr(doc: unknown, expr: string): unknown {
  if (expr === "$" || expr === "") return doc;
  const body = expr.startsWith("$") ? expr.slice(1) : expr;
  const tokens = body.match(/\.[A-Za-z_$][\w$]*|\[\d+\]/g);
  if (!tokens) return undefined;
  let cur: unknown = doc;
  for (const tok of tokens) {
    if (cur == null) return undefined;
    if (tok.startsWith("[")) {
      cur = Array.isArray(cur) ? cur[Number(tok.slice(1, -1))] : undefined;
    } else {
      const key = tok.slice(1);
      if (key === "length" && (Array.isArray(cur) || typeof cur === "string")) {
        cur = cur.length;
      } else if (typeof cur === "object") {
        cur = (cur as Record<string, unknown>)[key];
      } else {
        return undefined;
      }
    }
  }
  return cur;
}
