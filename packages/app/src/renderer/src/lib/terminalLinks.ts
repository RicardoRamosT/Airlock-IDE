// Pure detection for Cmd+clickable file paths in terminal output. No DOM / IPC:
// findPathCandidates scans one terminal line for path-like tokens; resolveRel
// maps a candidate to a project-root-relative path (or null if unopenable).
// TerminalPane wires these into xterm's link provider + an existence check.

export interface PathCandidate {
  // 0-based indices into the line: start = first char, end = LAST char
  // (inclusive). The token is line.slice(start, end + 1); the :line:col suffix,
  // when present, is part of the range so the whole token underlines.
  start: number;
  end: number;
  path: string; // the path part, without the :line:col suffix
  line?: number;
  col?: number;
}

// Bare (slash-less) filenames only link for a known code/text extension, so a
// sentence like "version 1.2.3" or "e.g." does not become a candidate. Paths
// WITH a slash accept any extension (the slash is signal enough).
const KNOWN_EXT = [
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "json",
  "jsonc",
  "md",
  "mdx",
  "css",
  "scss",
  "sass",
  "less",
  "html",
  "htm",
  "py",
  "go",
  "rs",
  "rb",
  "java",
  "kt",
  "kts",
  "c",
  "h",
  "hpp",
  "cc",
  "cpp",
  "sh",
  "bash",
  "zsh",
  "fish",
  "yml",
  "yaml",
  "toml",
  "lock",
  "txt",
  "log",
  "env",
  "sql",
  "vue",
  "svelte",
  "xml",
  "ini",
  "cfg",
  "conf",
  "gradle",
  "php",
  "swift",
  "dart",
  "ex",
  "exs",
  "clj",
  "lua",
  "tf",
].join("|");

// name.ext final segment (any extension; allows dotted/hyphenated names).
const FINAL = String.raw`[\w.@~+-]*\.[\w]{1,12}`;
// has at least one slash, optional leading / ./ or ../ prefix, ending in name.ext.
const SLASH = String.raw`(?:\.{0,2}\/)?(?:[\w.@~+-]+\/)+${FINAL}`;
// a bare filename, but only with a known extension.
const BARE = String.raw`[\w@~+-]+\.(?:${KNOWN_EXT})\b`;
const PATH_RE = new RegExp(`(${SLASH}|${BARE})(?::(\\d+)(?::(\\d+))?)?`, "g");
// A URL: drop any path candidate overlapping one (its host/path is not a file).
const URL_RE = /\b[a-z][a-z0-9+.-]*:\/\/\S+/gi;

export function findPathCandidates(line: string): PathCandidate[] {
  const urls: Array<[number, number]> = [];
  for (const m of line.matchAll(URL_RE)) {
    const s = m.index ?? 0;
    urls.push([s, s + m[0].length - 1]);
  }
  const out: PathCandidate[] = [];
  for (const m of line.matchAll(PATH_RE)) {
    const path = m[1];
    if (path === undefined) continue; // group 1 always matches, but narrow it
    const start = m.index ?? 0;
    const end = start + m[0].length - 1;
    if (urls.some(([us, ue]) => start <= ue && end >= us)) continue; // in a URL
    out.push({
      start,
      end,
      path,
      line: m[2] ? Number(m[2]) : undefined,
      col: m[3] ? Number(m[3]) : undefined,
    });
  }
  return out;
}

// A path candidate located in the terminal's cell grid: its buffer range is
// 1-based and end-inclusive (xterm's convention) and MAY span rows (a wrapped
// path). Produced by linksForRows for the xterm link provider.
export interface BufferLink {
  path: string;
  line?: number;
  col?: number;
  text: string;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

// Reconstruct consecutive terminal rows (each `cols` cells wide) into one
// logical line, find path candidates across it, and map each candidate's char
// offsets back to a 1-based cell range — so a path that WRAPPED across rows is
// detected whole and highlighted across both rows. `firstRowAbs` is the 0-based
// absolute buffer index of rows[0]. (ASCII paths only: 1 char == 1 cell.)
export function linksForRows(
  rows: string[],
  cols: number,
  firstRowAbs: number,
): BufferLink[] {
  const width = cols > 0 ? cols : 1;
  const full = rows.map((r) => r.padEnd(width, " ").slice(0, width)).join("");
  return findPathCandidates(full).map((c) => ({
    path: c.path,
    line: c.line,
    col: c.col,
    text: full.slice(c.start, c.end + 1),
    startX: (c.start % width) + 1,
    startY: firstRowAbs + Math.floor(c.start / width) + 1,
    endX: (c.end % width) + 1,
    endY: firstRowAbs + Math.floor(c.end / width) + 1,
  }));
}

// Map a candidate path to a path relative to `root`, or null if it cannot be
// opened in the editor (an absolute path outside root, or the root itself).
export function resolveRel(root: string, path: string): string | null {
  const p = path.replace(/^\.\//, "");
  if (p.startsWith("/")) {
    if (p === root) return null;
    if (p.startsWith(`${root}/`)) return p.slice(root.length + 1);
    return null; // absolute, outside the project
  }
  return p.length > 0 ? p : null;
}
