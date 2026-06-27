import { appendFile, mkdir, rename, stat } from "node:fs/promises";
import path from "node:path";
import type { LogEvent } from "./types";
import type { Sink } from "./writer";

export interface FileSinkOpts {
  maxBytes: number; // rotate the active file once it would exceed this
  keepFiles: number; // total files to keep (active + rotations)
}

function rotatedName(logFile: string, n: number): string {
  const dir = path.dirname(logFile);
  const base = path.basename(logFile, ".jsonl");
  return path.join(dir, `${base}.${n}.jsonl`);
}

// active -> .1, .1 -> .2, ... dropping the oldest. rename overwrites on POSIX.
async function rotate(logFile: string, keep: number): Promise<void> {
  for (let i = keep - 1; i >= 1; i--) {
    const from = i === 1 ? logFile : rotatedName(logFile, i - 1);
    const to = rotatedName(logFile, i);
    try {
      await rename(from, to);
    } catch {
      // a missing intermediate file is fine — nothing to shift
    }
  }
}

// A Sink that appends to logFile with a single appendFile per batch (no
// read-modify-write) and rotates by a running byte count (no stat per write).
export function createFileSink(logFile: string, opts: FileSinkOpts): Sink {
  let bytes = -1; // -1 = unknown; lazily seeded from the file on first append
  return async (batch: LogEvent[]) => {
    if (batch.length === 0) return;
    const text = `${batch.map((e) => JSON.stringify(e)).join("\n")}\n`;
    const size = Buffer.byteLength(text);
    await mkdir(path.dirname(logFile), { recursive: true });
    if (bytes < 0) {
      try {
        bytes = (await stat(logFile)).size;
      } catch {
        bytes = 0;
      }
    }
    if (bytes > 0 && bytes + size > opts.maxBytes) {
      await rotate(logFile, opts.keepFiles);
      bytes = 0;
    }
    await appendFile(logFile, text, "utf8");
    bytes += size;
  };
}
