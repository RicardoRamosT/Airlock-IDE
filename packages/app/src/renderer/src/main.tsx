import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { AtlasPopover } from "./components/AtlasPopover";
import "@vscode/codicons/dist/codicon.css";
import "./theme.css";

// Funnel renderer runtime errors into AirLock's main event log so `read_events`
// surfaces frontend crashes too (not just main-process errors). Guarded so a
// failure while reporting an error can never loop.
function reportRendererError(
  kind: "error" | "unhandledrejection",
  message: string,
  extra: { source?: string; line?: number; col?: number; stack?: string } = {},
) {
  try {
    window.airlock?.reportRendererError({ kind, message, ...extra });
  } catch {
    /* logging must never throw */
  }
}
window.addEventListener("error", (e) => {
  reportRendererError("error", e.message || String(e.error), {
    source: e.filename,
    line: e.lineno,
    col: e.colno,
    stack: e.error instanceof Error ? e.error.stack : undefined,
  });
});
window.addEventListener("unhandledrejection", (e) => {
  const r = e.reason;
  reportRendererError(
    "unhandledrejection",
    r instanceof Error ? r.message : String(r),
    { stack: r instanceof Error ? r.stack : undefined },
  );
});

// The Atlas popover reuses this single renderer entry via a hash, so there is
// no second build target and no change to electron.vite.config.ts.
const isAtlas = window.location.hash === "#atlas";

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>{isAtlas ? <AtlasPopover /> : <App />}</React.StrictMode>,
);
