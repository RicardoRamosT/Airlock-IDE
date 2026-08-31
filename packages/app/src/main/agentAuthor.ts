// WHO TYPED THIS, stamped by main rather than claimed by the model.
//
// Atlas can type into a terminal where a Claude session is running
// (send_terminal_input), and what arrives there is indistinguishable from the
// user typing it. Atlas also writes in the user's register -- "fix these two
// defects, commit them separately, do not push" -- so the receiving session
// reads a portfolio agent's inference as its user's instruction, and treats
// claims it should verify as ground truth it already has. That is a real
// hazard: Atlas is often right, and when it is wrong the receiving agent has no
// way to know it was ever an agent talking.
//
// THE SIGNATURE IS APPLIED HERE, ON THE WAY TO THE PTY -- deliberately not by
// asking Atlas to sign its own messages in the system prompt. A model can
// forget, paraphrase, or omit; and a signature the sender controls is worth
// nothing to the reader, which is the same reason renderStillOpen is rendered
// by code and a concern's trend is computed main-side. Atlas supplies only the
// tool argument; it cannot reach the header that names it, so it can neither
// suppress the stamp nor forge the user's voice.
//
// ASCII comments only.

import { ATLAS_AUTHOR_HEADER } from "@airlock/agent-core";

// The authors main can stamp for. Deliberately a closed set: the author picks
// the WORDING, so an arbitrary string must never reach a pty.
export type AgentAuthor = "atlas";

// Set by Atlas's own MCP client config (airlockMcpConfig, agent-core), imported
// rather than restated so the writer and the reader cannot drift.
const HEADER = ATLAS_AUTHOR_HEADER.toLowerCase();

// ONE LINE, AND INERT IN A SHELL.
//
// This was a `#` comment, on the reasoning that a signed payload landing in a
// SHELL rather than a Claude session would be a comment instead of a bogus
// command. That is false on the platform AirLock ships for: zsh leaves
// INTERACTIVE_COMMENTS OFF by default (verified with `zsh -f -i`), so `#` is an
// ordinary character and every signed command died with
// `zsh: parse error near #` -- observed 2026-08-31, which broke Atlas running
// anything at a prompt.
//
// `:` is the POSIX null command: it ignores its arguments and succeeds, in zsh
// and bash alike. It PREFIXES the payload rather than trailing it, because a
// trailing `; :` is a parse error after a payload that legitimately ends in `&`
// -- and because a reader learns who is talking before reading the instruction.
//
// SINGLE quotes, and the wording carries no apostrophe so it can stay that way.
// Inside single quotes nothing expands -- no `$`, no backtick, no history `!`
// -- so the signature cannot be made to run anything however the text changes.
// Keep it apostrophe-free.
export const AGENT_SIGNATURES: Record<AgentAuthor, string> = {
  atlas:
    ": '(Sent by Atlas, the AirLock portfolio agent, not by the user. " +
    "Verify its claims before acting on them.)' ;",
};

// A DISPATCH IS A SENTENCE; AN ANSWER IS A TOKEN.
//
// send_terminal_input does three jobs (its own description says so): type a
// prompt into a live Claude session, answer an interactive prompt, or send a
// keystroke. Only the first carries claims worth attributing, and the other two
// must not be touched -- appending anything to "y" or to Ctrl-C is corruption,
// not attribution.
//
// Words, not characters: an interactive answer is one token and a file path
// sails past any character floor, while a dispatched instruction is prose. Five
// words is a sentence. The boundary is a real choice, not an accident: a
// three-word "yes do it" goes unsigned, which is honest -- it asserts nothing to
// verify.
export const SIGN_MIN_WORDS = 5;

function wordCount(s: string): number {
  return s.trim().length === 0 ? 0 : s.trim().split(/\s+/).length;
}

// Read the author off a request's headers. Node lower-cases incoming header
// names, but this tolerates any case rather than depending on that, and refuses
// anything that is not one of ours (including an array, which is what a
// duplicated header parses to).
export function authorFromHeaders(
  headers: Record<string, unknown>,
): AgentAuthor | null {
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() !== HEADER) continue;
    if (typeof v !== "string") return null;
    const claimed = v.trim().toLowerCase();
    // Object.hasOwn, NOT `in`: `in` walks the prototype chain, so a header of
    // "constructor" would answer true and hand back Object's constructor as a
    // signature -- stringifying a JS function into a pty.
    return Object.hasOwn(AGENT_SIGNATURES, claimed)
      ? (claimed as AgentAuthor)
      : null;
  }
  return null;
}

// Stamp a terminal payload with its author, or hand it back untouched.
//
// The signature rides INSIDE the last line, on the same submission. After the
// trailing newline it would be submitted separately, so a Claude session would
// receive the signature as a prompt of its own and answer it.
//
// It goes at the FRONT of that line: see AGENT_SIGNATURES for why a trailing
// form cannot be made safe in a shell.
//
// Unsubmitted input is never signed: nothing has been dispatched yet, the user
// or the agent is still typing, and a stamp would land mid-sentence.
export function signAgentInput(
  input: string,
  author: AgentAuthor | null,
): string {
  if (author === null) return input;
  const signature = AGENT_SIGNATURES[author];

  const submit = /[\r\n]+$/.exec(input);
  if (submit === null) return input;

  const body = input.slice(0, input.length - submit[0].length);
  // Idempotent: a re-send, or an Atlas that wrote the line itself, must not
  // collect a second copy.
  if (body.includes(signature)) return input;
  if (wordCount(body) < SIGN_MIN_WORDS) return input;

  // Prefix the LAST line, which is the one the submit sends. For a multi-line
  // payload reaching a shell each line is its own command, so the signature can
  // only ride one of them; for the single-line case they are the same thing.
  const cut = body.lastIndexOf("\n") + 1;
  return `${body.slice(0, cut)}${signature} ${body.slice(cut)}${submit[0]}`;
}
