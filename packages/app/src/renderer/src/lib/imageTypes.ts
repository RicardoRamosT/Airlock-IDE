// Raster image extensions the viewer previews inline. SVG is intentionally NOT
// here -- it edits as text. Keep in sync with IMAGE_MIME in agent-core read.ts.
const IMAGE_EXTS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "ico",
  "avif",
]);

export function isImagePath(relPath: string): boolean {
  const i = relPath.lastIndexOf(".");
  if (i < 0) return false;
  return IMAGE_EXTS.has(relPath.slice(i + 1).toLowerCase());
}
