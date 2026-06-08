import { type FileContent, readWorkspaceFile } from "./read";
import { listFilesRecursive } from "./tree";

export interface SearchMatch {
  line: number;
  col: number;
  preview: string;
}
export interface SearchFileResult {
  path: string;
  matches: SearchMatch[];
}
export interface SearchResults {
  files: SearchFileResult[];
  truncated: boolean;
}

const MAX_RESULTS = 1000;
const MAX_PER_FILE = 50;
const PREVIEW_LEN = 200;

// Zero-dep project text search: walk the file list (IGNORED dirs already pruned),
// read each text file (binaries skipped), and collect the first case-insensitive
// substring match per line. Capped by maxResults (total) and maxPerFile; either
// cap sets truncated so the UI can say "showing first N". ASCII-only file.
export async function searchProject(
  root: string,
  query: string,
  opts?: { maxResults?: number; maxPerFile?: number },
): Promise<SearchResults> {
  const q = query.toLowerCase();
  if (q.trim() === "") return { files: [], truncated: false };
  const maxResults = opts?.maxResults ?? MAX_RESULTS;
  const maxPerFile = opts?.maxPerFile ?? MAX_PER_FILE;

  const { files: paths } = await listFilesRecursive(root);
  const files: SearchFileResult[] = [];
  let total = 0;
  let truncated = false;

  for (const path of paths) {
    if (total >= maxResults) {
      truncated = true;
      break;
    }
    let fc: FileContent;
    try {
      fc = await readWorkspaceFile(root, path);
    } catch {
      continue; // unreadable -- skip
    }
    if (fc.binary || fc.content === "") continue;
    const matches: SearchMatch[] = [];
    const lines = fc.content.split("\n");
    for (let i = 0; i < lines.length && total < maxResults; i++) {
      const raw = lines[i] ?? "";
      const col = raw.toLowerCase().indexOf(q);
      if (col < 0) continue;
      if (matches.length >= maxPerFile) {
        truncated = true;
        break;
      }
      matches.push({ line: i + 1, col, preview: raw.slice(0, PREVIEW_LEN) });
      total += 1;
    }
    if (total >= maxResults) truncated = true;
    if (matches.length > 0) files.push({ path, matches });
  }
  return { files, truncated };
}
