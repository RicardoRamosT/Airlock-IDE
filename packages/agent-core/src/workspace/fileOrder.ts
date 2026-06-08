import { readFile, rename, writeFile } from "node:fs/promises";
import { ORDER_FILE, resolveWithin } from "./tree";

// Per-folder custom file ordering, persisted to <root>/.airlock-order.json so it
// travels with the project. Keys are folder relpaths ("." = root); values are
// entry NAMES (basenames) in the user's chosen order. ASCII-only file (bundled
// into the Electron CJS main). The file is hidden from the tree (tree.ts
// IGNORED) and from the watcher (main/fsWatch.ts), so writing it never churns
// the UI.

const VERSION = 1;

// folderRel -> ordered entry names. A folder absent here uses the default sort.
export type OrderMap = Record<string, string[]>;

// Keep only well-formed entries: folderRel -> array of name strings.
function sanitize(raw: unknown): OrderMap {
  const out: OrderMap = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [folder, names] of Object.entries(
    raw as Record<string, unknown>,
  )) {
    if (Array.isArray(names) && names.every((n) => typeof n === "string")) {
      out[folder] = names as string[];
    }
  }
  return out;
}

// Read the saved order map. A missing file, malformed JSON, or an unrecognized
// version all yield an empty map (-> default sort everywhere). Never throws.
export async function readOrder(root: string): Promise<OrderMap> {
  const abs = await resolveWithin(root, ORDER_FILE);
  let text: string;
  try {
    text = await readFile(abs, "utf8");
  } catch {
    return {};
  }
  try {
    const raw = JSON.parse(text) as { version?: unknown; order?: unknown };
    if (!raw || typeof raw !== "object" || raw.version !== VERSION) return {};
    return sanitize(raw.order);
  } catch {
    return {};
  }
}

// Set (or clear) one folder's order via read-modify-write. An empty names array
// deletes the folder's key (-> back to default sort). Writes atomically through
// a temp file + rename, mirroring main/prefs.ts.
export async function writeFolderOrder(
  root: string,
  folderRel: string,
  names: string[],
): Promise<void> {
  const map = await readOrder(root);
  if (names.length === 0) delete map[folderRel];
  else map[folderRel] = names;
  const abs = await resolveWithin(root, ORDER_FILE);
  const body = `${JSON.stringify({ version: VERSION, order: map }, null, 2)}\n`;
  const tmp = `${abs}.tmp`;
  await writeFile(tmp, body, { encoding: "utf8" });
  await rename(tmp, abs);
}
