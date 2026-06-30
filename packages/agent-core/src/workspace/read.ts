import { open } from "node:fs/promises";
import { resolveWithin, targetsVault } from "./tree";

export interface FileContent {
  content: string;
  truncated: boolean;
  binary: boolean;
  size: number;
}

export const MAX_FILE_BYTES = 1_000_000;

export async function readWorkspaceFile(
  root: string,
  relPath: string,
): Promise<FileContent> {
  // Self-guard: the .airlock vault holds the secret-NAME inventory and the audit
  // log; reading it through the generic file API would expose both. The
  // fs:readFile handler rejects it too; guard here so every caller is covered.
  // (audit H7)
  if (targetsVault(relPath))
    throw new Error("The .airlock folder is protected");
  const abs = await resolveWithin(root, relPath);
  const fh = await open(abs, "r");
  try {
    const { size } = await fh.stat();
    // Binary probe: a NUL byte in the first 8000 bytes means binary (git's
    // heuristic). Skip the UTF-8 decode so the editor never shows byte-soup.
    const probeLen = Math.min(size, 8000);
    if (probeLen > 0) {
      const probe = Buffer.alloc(probeLen);
      await fh.read(probe, 0, probeLen, 0);
      if (probe.includes(0))
        return { content: "", truncated: false, binary: true, size };
    }
    if (size <= MAX_FILE_BYTES) {
      const buf = await fh.readFile();
      return {
        content: buf.toString("utf8"),
        truncated: false,
        binary: false,
        size,
      };
    }
    // NOTE: truncating at a byte boundary can split a multi-byte UTF-8
    // codepoint; Buffer.toString('utf8') replaces the broken tail with U+FFFD.
    // Acceptable for the read-only viewer (truncated:true is already set).
    const buf = Buffer.alloc(MAX_FILE_BYTES);
    await fh.read(buf, 0, MAX_FILE_BYTES, 0);
    return {
      content: buf.toString("utf8"),
      truncated: true,
      binary: false,
      size,
    };
  } finally {
    await fh.close();
  }
}

// Extension -> mime for inline image preview. Keep in sync with IMAGE_EXTS in
// the renderer's lib/imageTypes.ts.
const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  ico: "image/x-icon",
  avif: "image/avif",
};

// Inline a PDF as a data: URL for the built-in Chromium viewer. Mirrors
// readImageDataUrl: vault-guarded, size-capped (default 50 MB) so a huge PDF
// falls back to Open-externally instead of bloating the renderer.
export async function readPdfDataUrl(
  root: string,
  relPath: string,
  max = 50_000_000,
): Promise<{ dataUrl: string; tooLarge: boolean }> {
  if (targetsVault(relPath))
    throw new Error("The .airlock folder is protected");
  const abs = await resolveWithin(root, relPath);
  const fh = await open(abs, "r");
  try {
    const { size } = await fh.stat();
    if (size > max) return { dataUrl: "", tooLarge: true };
    const buf = await fh.readFile();
    return {
      dataUrl: `data:application/pdf;base64,${buf.toString("base64")}`,
      tooLarge: false,
    };
  } finally {
    await fh.close();
  }
}

// Read a (raster) image as a data URL for the renderer's <img>. Path-confined.
// Over `max` bytes -> { dataUrl: "", tooLarge: true } so the caller can offer
// "open externally". Never decodes as text. ASCII-only file.
export async function readImageDataUrl(
  root: string,
  relPath: string,
  max = 25_000_000,
): Promise<{ dataUrl: string; tooLarge: boolean }> {
  // Same vault self-guard as readWorkspaceFile: never base64 vault bytes out to
  // the renderer, even via the image path. (audit H7, uniform guard)
  if (targetsVault(relPath))
    throw new Error("The .airlock folder is protected");
  const abs = await resolveWithin(root, relPath);
  const fh = await open(abs, "r");
  try {
    const { size } = await fh.stat();
    if (size > max) return { dataUrl: "", tooLarge: true };
    const buf = await fh.readFile();
    const ext = relPath.slice(relPath.lastIndexOf(".") + 1).toLowerCase();
    const mime = IMAGE_MIME[ext] ?? "application/octet-stream";
    return {
      dataUrl: `data:${mime};base64,${buf.toString("base64")}`,
      tooLarge: false,
    };
  } finally {
    await fh.close();
  }
}
