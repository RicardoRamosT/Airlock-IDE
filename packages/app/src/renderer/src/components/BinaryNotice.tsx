function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Shown for a non-image binary file instead of byte-soup: what it is, how big,
// and a way to open it in the OS default app.
export function BinaryNotice({
  root,
  relPath,
  size,
}: {
  root: string;
  relPath: string;
  size: number;
}) {
  return (
    <div className="binary-notice">
      <div>Binary file -- {formatSize(size)} -- not shown</div>
      <button
        type="button"
        className="btn"
        onClick={() => void window.airlock.openExternalFile(root, relPath)}
      >
        Open externally
      </button>
    </div>
  );
}
