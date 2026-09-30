import { resolveRepoPath } from "./markdownLinks";

// Resolve a link href from .airlock/overview.md to a PROJECT-ROOT-RELATIVE file
// path the editor can open, or null when it isn't an openable in-repo file.
//
// overview.md lives at <root>/.airlock/overview.md, so its markdown links are
// relative to the .airlock/ dir — Claude writes e.g. "../packages/app/src/x.ts"
// to point at <root>/packages/app/src/x.ts. We resolve against ".airlock/",
// collapse "."/".." segments, and reject anything that:
//   - is an external/other-scheme URL (http(s) is opened in the browser instead)
//   - is an absolute path or a bare #anchor (no file to open)
//   - escapes the project root via ".." (never open outside the project)
export function resolveOverviewLink(href: string): string | null {
  const h = href.trim();
  if (!h || h.startsWith("#") || h.startsWith("/")) return null;
  if (/^https?:\/\//i.test(h)) return null; // external — opened in the browser
  if (/^[a-z][a-z0-9+.-]*:/i.test(h)) return null; // other scheme (javascript:, …)
  // The path arithmetic is shared with the markdown file preview, which resolves
  // against whatever file is open; overview.md is just the file at this path.
  return resolveRepoPath(".airlock/overview.md", h);
}
