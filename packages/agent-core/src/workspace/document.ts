// Read a .docx into the structured document model the renderer draws.
// Runs in main only; the renderer receives DocumentData over IPC.
//
// A .docx is a zip of XML parts. This module is the I/O half -- open the zip,
// hand the XML to the pure parser, and turn embedded image parts into data:
// URIs. All interpretation lives in docxModel.ts so it can be unit tested
// without a filesystem.
//
// A Word document is UNTRUSTED input (it may have arrived from Slack, email or
// a repo). Nothing here produces markup: the model is plain data with validated
// fields, so there is no HTML string for the renderer to sanitise or inject.
// ASCII-only file.
import { readFile, stat } from "node:fs/promises";
import JSZip from "jszip";
import { type DocxDoc, parseDocx } from "./docxModel";
import { resolveWithin, targetsVault } from "./tree";

export interface DocumentData {
  doc: DocxDoc;
  tooLarge: boolean;
  // Parts of the document that could not be shown (an unsupported image
  // format, an unreadable zip member). Surfaced so the viewer can admit what
  // is missing instead of silently rendering an incomplete document.
  notes: string[];
}

// Word embeds images as parts inside the zip, so a document with photos is
// mostly image bytes. 25 MB of .docx is already an unusual document, and the
// model it expands to (base64 inlining is ~4/3) still has to cross IPC.
const MAX_BYTES = 25 * 1024 * 1024;

// Raster formats a Chromium <img> renders from a data: URI. SVG is deliberately
// absent: it is an active document (script, external refs), and an untrusted
// one has no business in the app's DOM. EMF/WMF are Word-only vector formats
// the browser cannot draw at all.
const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  bmp: "image/bmp",
  webp: "image/webp",
  tif: "image/tiff",
  tiff: "image/tiff",
};

const extOf = (p: string) => p.slice(p.lastIndexOf(".") + 1).toLowerCase();

// Total budget for inlined images. Each one is base64 (+33%) and the whole
// model crosses IPC as a single structured-clone payload, so an image-heavy
// document could otherwise pin hundreds of MB in both processes.
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

async function readPart(zip: JSZip, path: string): Promise<string | undefined> {
  const f = zip.file(path);
  if (!f) return undefined;
  try {
    return await f.async("string");
  } catch {
    return undefined;
  }
}

// word/_rels/document.xml.rels maps a relationship id (rId7) to the part that
// holds the bytes (media/image1.png). Only image relationships are followed --
// a .docx can also link out to hyperlinks, embedded objects and external files.
async function readImages(
  zip: JSZip,
  notes: string[],
): Promise<Record<string, string>> {
  const rels = await readPart(zip, "word/_rels/document.xml.rels");
  if (!rels) return {};
  const out: Record<string, string> = {};
  let budget = MAX_IMAGE_BYTES;
  // The rels part is a flat list of <Relationship Id=".." Type=".." Target=".."/>.
  const re = /<Relationship\b[^>]*\/?>/g;
  for (const [tag] of rels.matchAll(re)) {
    const id = /\bId="([^"]+)"/.exec(tag)?.[1];
    const target = /\bTarget="([^"]+)"/.exec(tag)?.[1];
    const type = /\bType="([^"]+)"/.exec(tag)?.[1] ?? "";
    if (!id || !target || !/\/image$/.test(type)) continue;
    // An external image would be a network fetch (and a tracking pixel); only
    // parts inside this zip are inlined.
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("//")) {
      notes.push(`Skipped an image stored outside the document (${id}).`);
      continue;
    }
    const mime = IMAGE_MIME[extOf(target)];
    if (!mime) {
      notes.push(`Unsupported image format: ${extOf(target) || "unknown"}.`);
      continue;
    }
    // Targets are relative to word/, and may climb with "../".
    const path = `word/${target}`.replace(/\/\.\//g, "/");
    const file = zip.file(path.replace(/^word\/\.\.\//, ""));
    if (!file) continue;
    try {
      const buf = await file.async("nodebuffer");
      if (buf.byteLength > budget) {
        notes.push("Some images were too large to display.");
        continue;
      }
      budget -= buf.byteLength;
      out[id] = `data:${mime};base64,${buf.toString("base64")}`;
    } catch {
      notes.push("An image could not be read.");
    }
  }
  return out;
}

const EMPTY: DocxDoc = {
  blocks: [],
  page: { width: 612, margin: { top: 72, right: 72, bottom: 72, left: 72 } },
};

export async function readDocument(
  root: string,
  relPath: string,
  max = MAX_BYTES,
): Promise<DocumentData> {
  if (targetsVault(relPath))
    throw new Error("The .airlock folder is protected");
  const abs = await resolveWithin(root, relPath);
  const { size } = await stat(abs);
  if (size > max) return { doc: EMPTY, tooLarge: true, notes: [] };

  const zip = await JSZip.loadAsync(await readFile(abs));
  const documentXml = await readPart(zip, "word/document.xml");
  if (!documentXml) {
    return {
      doc: EMPTY,
      tooLarge: false,
      notes: ["This file is not a Word document (no word/document.xml)."],
    };
  }
  const notes: string[] = [];
  const doc = parseDocx({
    documentXml,
    stylesXml: await readPart(zip, "word/styles.xml"),
    numberingXml: await readPart(zip, "word/numbering.xml"),
    images: await readImages(zip, notes),
  });
  return { doc, tooLarge: false, notes: [...new Set(notes)].slice(0, 20) };
}
