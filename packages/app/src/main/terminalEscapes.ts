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

// SUBMIT IS A SEPARATE KEYSTROKE, NOT A CHARACTER IN THE PAYLOAD.
//
// send_terminal_input's description promises "type a prompt into a live Claude
// session" and "include a newline to submit a line". Both are true of a shell
// and only the first is true of a TUI.
//
// A running Claude reads in raw mode with bracketed paste: a chunk that arrives
// all at once is PASTED CONTENT, and a carriage return inside pasted content is
// a line break in the composer, not Enter. So `git status\r` written as one
// chunk is typed and never sent -- observed twice on 2026-08-31, first with LF
// and again after converting the trailing LF to CR, which changed nothing
// because the problem was never the character.
//
// It reached a shell fine both times, because a shell's line discipline submits
// on CR however it arrives. That difference is exactly what made this look
// fixed.
//
// The renderer already knew: sendOverviewPromptNow writes the prompt, waits, and
// then sends OVERVIEW_SUBMIT_KEY ("\r") as its own write. This is that, moved
// to the choke point every agent write passes through.
export const SUBMIT_KEY = "\r";

// Long enough for the TUI to commit the paste before Enter lands. Matches
// OVERVIEW_SUBMIT_DELAY_MS in the renderer store, which cannot be imported here
// (main must not pull renderer code); the two are deliberately the same number.
export const SUBMIT_DELAY_MS = 120;

// Split a payload into what to TYPE and whether to press Enter afterwards.
// A payload with no trailing newline was never a submit: the agent is typing
// without sending, which is a supported thing to do.
export function splitSubmit(data: string): {
  body: string;
  submit: string | null;
} {
  const m = /[\r\n]+$/.exec(data);
  if (m === null) return { body: data, submit: null };
  return { body: data.slice(0, data.length - m[0].length), submit: SUBMIT_KEY };
}
