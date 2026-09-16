// ASCII comments only. Turn a string into the bytes bound as TEXT, and refuse
// to hand SQLite a short buffer.
//
// THE BUG THIS EXISTS FOR, and the arithmetic that identified it.
//
// Four Atlas rows were found stored SHORT on 2026-09-16, with no error
// anywhere: six of eighteen snapshots were unparseable, two debriefs ended
// mid-word, and a standup row stopped at `"quiet":`. For every row whose
// missing suffix is deterministic, the stored size obeys one relation exactly:
//
//     stored BYTES == original CHARACTERS - 1
//
//   snapshot 09-03   stored 11556c / 11557b   original 11558c   ->  11557  ok
//   snapshot 09-04   stored 14789c / 14790b   original 14791c   ->  14790  ok
//   standup  09-16   stored 23869c / 23870b   original 23871c   ->  23870  ok
//   brief    09-06   stored  1787c /  1789b   original  1790c   ->   1789  ok
//
// A UTF-16 character count used as a BYTE capacity, minus one for a NUL
// terminator. That is precisely the shape of the assertion store.ts documents,
// `(length + 1) <= capacity()`, which aborted this machine twice with crash
// reports. Where the assert is compiled out, the same misprediction truncates
// to capacity - 1 instead of crashing: one root cause, two symptoms.
//
// bytes() was written to keep strings out of node:sqlite's Utf8Value. It did
// not help, because TextEncoder.encode is ALSO a Node UTF-8 length
// computation -- the workaround moved the bug rather than removing it. Every
// isolated reproduction attempt came back clean (system Node, Electron main,
// Electron utilityProcess, in-memory and file-backed, ASCII and multibyte, to
// 80 KB), which matches store.ts's own note that replaying the exact bind
// 20000 times reproduces nothing. It is intermittent and environmental.
//
// So this does not trust the encoder. It checks the encoder's own output
// against Buffer.byteLength -- a different code path to the same answer -- and
// re-encodes through Buffer when they disagree. Disagreement is the
// misprediction caught in the act, so it is reported rather than silently
// repaired.

const TEXT_ENCODER = new TextEncoder();

export interface Encoder {
  encode(s: string): Uint8Array;
}

export function encodeText(
  s: string,
  encoder: Encoder = TEXT_ENCODER,
  onMispredict?: (got: number, want: number) => void,
): Uint8Array | string {
  // An empty string binds as a plain string: a zero-length Uint8Array binds as
  // NULL, and CAST(NULL AS TEXT) fails every NOT NULL column here.
  if (s.length === 0) return "";

  const want = Buffer.byteLength(s, "utf8");
  const out = encoder.encode(s);
  if (out.byteLength === want) return out;

  // Caught mispredicting. Buffer.from reaches the same answer by another path.
  onMispredict?.(out.byteLength, want);
  const viaBuffer = Buffer.from(s, "utf8");
  if (viaBuffer.byteLength === want) return new Uint8Array(viaBuffer);

  // Both disagree with byteLength. Refuse rather than store a short value:
  // writeVerified would catch it anyway, but failing here names the cause.
  throw new Error(
    `atlas: utf-8 encode mispredicted ${out.byteLength} and ${viaBuffer.byteLength} bytes for ${want}`,
  );
}
