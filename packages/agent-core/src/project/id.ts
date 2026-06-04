import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import path from "node:path";

/**
 * Stable per-project identity: "<basename>-<sha256(realpath) first 8 hex>".
 * Used to scope keychain accounts so equally-named projects do not collide.
 */
export async function projectIdFor(root: string): Promise<string> {
  const real = await realpath(path.resolve(root));
  const hash = createHash("sha256").update(real).digest("hex").slice(0, 8);
  return `${path.basename(real)}-${hash}`;
}
