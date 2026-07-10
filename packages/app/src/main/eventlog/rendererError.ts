// packages/app/src/main/eventlog/rendererError.ts
// Pure mapper: a renderer-reported error payload -> an EmitInput for the event
// log. Kept pure so it is unit-tested off Electron; the IPC + window wiring is thin.
export interface RendererErrorPayload {
  kind: "error" | "unhandledrejection";
  message: string;
  source?: string;
  line?: number;
  col?: number;
  stack?: string;
}

export function toRendererErrorEvent(p: RendererErrorPayload): {
  level: "error";
  category: "renderer";
  op: string;
  error: { message: string; stack?: string };
  detail: Record<string, unknown>;
} {
  const op =
    p.kind === "unhandledrejection"
      ? "renderer.unhandledrejection"
      : "renderer.error";
  const where =
    p.source && typeof p.line === "number" ? ` (${p.source}:${p.line})` : "";
  return {
    level: "error",
    category: "renderer",
    op,
    error: { message: `${p.message}${where}`, stack: p.stack },
    detail: { source: p.source, line: p.line, col: p.col },
  };
}
