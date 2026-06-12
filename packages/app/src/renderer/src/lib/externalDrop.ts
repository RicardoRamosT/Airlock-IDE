// A drag originating from Finder/the OS exposes a "Files" entry in
// DataTransfer.types; an internal tree move sets only "text/plain" (the dragged
// relpath). This distinguishes the two so the FileTree can branch.
export function isExternalFileDrag(types: readonly string[]): boolean {
  return types.includes("Files");
}
