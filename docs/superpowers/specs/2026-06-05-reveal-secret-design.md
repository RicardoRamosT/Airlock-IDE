# Reveal Secret Value (owner-only) + auto-clearing copy

**Date:** 2026-06-05
**Status:** v1 complete.

## Overview
Let the human OWNER reveal and copy a vaulted secret's value in airlock's Secrets
sidebar -- without giving the AI agent any value path. Each secret row gets a
hover-revealed eye (toggle to show the value inline) and a copy button (puts the
value on the system clipboard, then auto-clears it after a configurable delay,
default 30s, set in Settings with the risk explained).

## Threat model (the crux -- why this is safe)
airlock's core promise is specifically: the AGENT (the terminal Claude, over the
MCP server) is structurally unable to read secret values. The renderer is the
OWNER's surface; the agent is a separate OS process that cannot read the
renderer's memory/DOM and cannot call its IPC. So an owner-triggered reveal does
NOT breach the promise -- the agent gains no path.

This DOES relax the prior defense-in-depth posture ("a value never leaves the main
process"). On an explicit owner action, the value now either (reveal) reaches the
renderer for display, or (copy) reaches the system clipboard. Mitigations:
- explicit click only (never auto-loaded), and audited (`secret.reveal` /
  `secret.copy`, NAME ONLY -- never the value);
- reveal is cleared from renderer state when the row is hidden / the list
  refreshes;
- copy is a by-NAME main operation: the value goes main -> clipboard and NEVER
  enters the renderer;
- the clipboard is conditionally auto-cleared after `clipboardClearSeconds`
  (default 30; 0 = never), wiping only if the clipboard still holds that value.

Honest residual risks (documented, not "fixed"):
1. The owner can always paste a revealed value into the agent themselves -- out of
   scope (the owner is the trust root; airlock cannot stop the owner sharing).
2. The clipboard is a shared OS surface -- the agent's shell could `pbpaste`
   within the clear window. Minimized by the by-name copy (value never in the
   renderer) + the auto-clear; the owner controls the window via the setting and
   is warned about it in Settings.

## The agent invariant is preserved structurally
NOTHING goes in `main/mcp/tools.ts`. The reveal/copy handlers live in
`main/ipc.ts` (the renderer IPC surface). The MCP allowlist stays exactly 11 and
the `getSecretValue` source-guard test stays green by construction. No MCP tool
returns a value; `list_secret_names` is still names-only.

## Design
- **`secrets:reveal(name)`** [renderer IPC, root-gated]: main `getSecretValue(root,
  name)` -> audit `secret.reveal {name}` -> return `string | null`. The ONLY path
  that brings a value into the renderer (for inline display).
- **`clipboard:copySecret(name)`** [renderer IPC, root-gated]: main
  `getSecretValue` -> `clipboard.writeText(value)` -> audit `secret.copy {name}` ->
  read `clipboardClearSeconds` from prefs; if > 0, schedule a CONDITIONAL clear
  (wipe only if `clipboard.readText()` still equals the copied value) -> return
  `{ copied, clearAfterSeconds }`. Value stays main -> clipboard.
- **`clipboardClearSeconds`** (app-global pref, default 30, clamp [0, 3600], 0 =
  never): on `AppPrefs` (shared) + `DEFAULTS` + `sanitize` (prefs.ts) + store +
  usePrefs hydrate + a SettingsTab "Secrets" number control with a risk
  explanation.
- **SecretsSection**: per-row eye toggle (reveal via `secretsReveal`, show inline,
  hide on toggle/refresh) + copy button (`clipboardCopySecret`, show a "copied --
  clears in Ns" hint). Hover-revealed like the existing `.secret-delete`.
- **broker.ts banner**: update the MAIN-ONLY banner to document the deliberate
  owner-only renderer reveal/copy exception (still never an agent tool).

## Out of scope (v1)
- Any agent/MCP path to a value (unchanged: zero).
- Preventing the owner from pasting a secret into the agent (owner is trust root).
- Third-party clipboard-manager history (airlock clears the live clipboard only;
  it cannot purge a clipboard manager's history -- noted in the risk copy).
- OS re-auth (Touch ID) on reveal -- a possible later hardening; v1 trusts the
  owner at their unlocked machine.
