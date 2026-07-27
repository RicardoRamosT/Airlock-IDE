// Parse a .docx into HTML for the renderer's inline document viewer.
// Mammoth runs in main only; the renderer receives DocumentData over IPC.
//
// A Word document is UNTRUSTED input (it may have arrived from Slack, email or
// a repo), so the HTML produced here is never injected as markup. The renderer
// walks it with DOMParser and rebuilds an allow-listed subset as React
// elements -- see DocxViewer. This module's job is only to get from a zip of
// XML to a string of tags.
// ASCII-only file.
import { stat } from "node:fs/promises";
import mammoth from "mammoth";
import { resolveWithin, targetsVault } from "./tree";

export interface DocumentData {
  html: string;
  tooLarge: boolean;
  // Mammoth reports unsupported constructs (unmapped styles, dropped objects).
  // Surfaced so the viewer can admit what it could not show instead of
  // silently rendering a document that is missing pieces.
  notes: string[];
}

// Word embeds images as parts inside the zip, so a document with photos is
// mostly image bytes. 25 MB of .docx is already an unusual document, and the
// HTML it expands to (base64 inlining is ~4/3) still has to cross IPC.
const MAX_BYTES = 25 * 1024 * 1024;

export async function readDocument(
  root: string,
  relPath: string,
  max = MAX_BYTES,
): Promise<DocumentData> {
  if (targetsVault(relPath))
    throw new Error("The .airlock folder is protected");
  const abs = await resolveWithin(root, relPath);
  const { size } = await stat(abs);
  if (size > max) return { html: "", tooLarge: true, notes: [] };

  // convertToHtml (not extractRawText): headings, lists and tables are most of
  // what makes a Word document readable, and dropping them would make the
  // viewer worse than opening the file elsewhere. Images come back as data:
  // URIs, which is also the only form the renderer's CSP would load.
  const result = await mammoth.convertToHtml({ path: abs });
  return {
    html: result.value,
    tooLarge: false,
    notes: [...new Set(result.messages.map((m) => m.message))].slice(0, 20),
  };
}
