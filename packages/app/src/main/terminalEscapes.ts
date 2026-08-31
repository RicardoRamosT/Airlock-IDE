// ASCII comments only. Decode escape sequences an agent wrote as LITERAL text.
//
// send_terminal_input writes its bytes verbatim, and its description tells the
// model to "include \n to submit a line". In a JSON tool argument that has to
// arrive as a real newline character -- but a model that writes "\\n" (or that
// has its argument re-encoded on the way) sends the two characters backslash
// and n instead. The bytes reach the pty, the shell prints them, and the line
// is never submitted: observed 2026-08-31 with `\rATLASPROBE ...` sitting
// unsent at a prompt while Atlas believed it had sent a command.
//
// So the two-character forms are decoded here. This is deliberately a SMALL,
// closed set -- the sequences that submit or interrupt, the ones whose absence
// is the difference between a command running and a command sitting there.
// Anything else is left exactly as written, because terminal input is arbitrary
// text and inventing meaning for it would corrupt real payloads.
//
// `\\` is decoded LAST-resort-proof: it consumes its own backslash, so "\\n"
// (an escaped backslash followed by n) yields a literal backslash and an n
// rather than a newline. A user or agent that genuinely wants a backslash can
// still express one.

const SIMPLE: Record<string, string> = {
  n: "\n",
  r: "\r",
  t: "\t",
  b: "\b",
  f: "\f",
  v: "\v",
  0: "\0",
  "\\": "\\",
};

export function decodeTerminalEscapes(data: string): string {
  if (!data.includes("\\")) return data; // the overwhelmingly common case
  let out = "";
  for (let i = 0; i < data.length; i++) {
    const ch = data[i] as string;
    if (ch !== "\\" || i === data.length - 1) {
      out += ch;
      continue;
    }
    const next = data[i + 1] as string;
    // \xNN and \uNNNN, so  (Ctrl-C) works as the tool description says.
    if (next === "x" || next === "u") {
      const width = next === "x" ? 2 : 4;
      const hex = data.slice(i + 2, i + 2 + width);
      if (hex.length === width && /^[0-9a-fA-F]+$/.test(hex)) {
        out += String.fromCharCode(Number.parseInt(hex, 16));
        i += 1 + width;
        continue;
      }
      // Not a valid escape: leave it alone rather than guess.
      out += ch;
      continue;
    }
    if (Object.hasOwn(SIMPLE, next)) {
      out += SIMPLE[next] as string;
      i += 1;
      continue;
    }
    // An unknown escape is not an escape. Pass the backslash through.
    out += ch;
  }
  return out;
}
