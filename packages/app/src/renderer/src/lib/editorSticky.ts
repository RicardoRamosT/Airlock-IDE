import { enclosingScopes, type Scope } from "./editorScopes";

// The scope headers to pin at the top of the viewport for a given top visible
// line: the enclosing scopes whose HEAD line is strictly above the top line
// (i.e. scrolled off), outer->inner, capped at `max` keeping the innermost
// (closest context). Pure -> unit-tested. Mirrors VS Code's default cap of 5.
export function stickyLines(
  scopes: Scope[],
  topVisibleLine: number,
  max = 5,
): Scope[] {
  const chain = enclosingScopes(scopes, topVisibleLine).filter(
    (s) => s.line < topVisibleLine,
  );
  return chain.length > max ? chain.slice(chain.length - max) : chain;
}
