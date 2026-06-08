// Pure normalizer for textDocument/definition replies. The server may return a
// single Location ({ uri, range }), an array of Location, or an array of
// LocationLink ({ targetUri, targetSelectionRange | targetRange }). Reduce any
// of these to the first target's uri + 0-indexed line, or null. ASCII-only
// (bundled into the CJS main).
export function firstDefinitionLocation(
  result: unknown,
): { uri: string; line: number } | null {
  const first = Array.isArray(result) ? result[0] : result;
  if (!first || typeof first !== "object") return null;
  const o = first as Record<string, unknown>;

  // LocationLink: targetUri + targetSelectionRange (preferred) or targetRange.
  if (typeof o.targetUri === "string") {
    const range = (o.targetSelectionRange ?? o.targetRange) as
      | { start?: { line?: unknown } }
      | undefined;
    const line = range?.start?.line;
    return typeof line === "number" ? { uri: o.targetUri, line } : null;
  }

  // Location: uri + range.
  if (typeof o.uri === "string") {
    const range = o.range as { start?: { line?: unknown } } | undefined;
    const line = range?.start?.line;
    if (typeof line === "number") return { uri: o.uri, line };
  }
  return null;
}
