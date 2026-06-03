import { open } from "node:fs/promises";
import { resolveWithin } from "./tree";

export interface FileContent {
  content: string;
  truncated: boolean;
}

export const MAX_FILE_BYTES = 1_000_000;

export async function readWorkspaceFile(
  root: string,
  relPath: string,
): Promise<FileContent> {
  const abs = await resolveWithin(root, relPath);
  const fh = await open(abs, "r");
  try {
    const { size } = await fh.stat();
    if (size <= MAX_FILE_BYTES) {
      const buf = await fh.readFile();
      return { content: buf.toString("utf8"), truncated: false };
    }
    const buf = Buffer.alloc(MAX_FILE_BYTES);
    await fh.read(buf, 0, MAX_FILE_BYTES, 0);
    return { content: buf.toString("utf8"), truncated: true };
  } finally {
    await fh.close();
  }
}
