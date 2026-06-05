# request_secret (Agent capability) Design

**Date:** 2026-06-05
**Status:** v1 complete.

## Overview
A new MCP tool, `request_secret`, that lets the terminal Claude ASK THE USER to vault a secret it needs. airlock opens the existing secure modal (pre-filled with the requested name); the user types + saves the value (which goes straight to the keychain); the agent gets back ONLY whether it was vaulted -- NEVER the value. It is the lowest-risk agent tool: there is no value path to the agent at all (it never calls getSecretValue).

## Why this tool exists
`run_command` fails closed when a requested secret is not vaulted ("requested secret not vaulted: X"). `request_secret` closes that loop: the agent asks the user to provide X, the user vaults it, and the agent retries `run_command`. It turns a dead-end into a one-step hand-off, without the agent ever seeing the value.

## The flow
1. Agent calls `request_secret(name, { providerHint?: string })`.
2. MCP tool (main, root-gated -- secrets vault per-project) -> a main-side `requestSecretFromUser(name, providerHint)` that:
   - generates a requestId, stores a resolver, and pushes `agent:request-secret { requestId, name, providerHint }` to the renderer (BrowserWindow webContents, like the sections:changed push);
   - returns a promise that resolves when the renderer reports the outcome, OR a timeout (~5 min) fires.
3. Renderer: on `agent:request-secret`, opens the SecretModal in an "agent-requested" mode -- the `name` is pre-filled and locked (the agent specified it), with a clear note: "Claude is requesting this secret to use on your behalf. It will be vaulted in your keychain; Claude never sees the value." The providerHint (e.g. "looks like a Postgres URL") is shown if present.
4. User SAVES (value -> keychain via the existing `secretsSet`/`setSecret`; the agent is never in this path) or CANCELS/closes.
5. Renderer invokes `agent:request-secret-resolved { requestId, vaulted: boolean }`; main resolves the matching promise.
6. Tool returns `{ vaulted: boolean }` (+ `timedOut: true` if the user never responded). The agent then re-tries its original action (e.g. run_command) if vaulted.

## Security model
- The value flows USER -> keychain ONLY (the existing setSecret path). `request_secret` NEVER returns, reads, or touches a value -- it does not call getSecretValue/getGlobalSecret. The tool result is a boolean.
- `tools.ts` stays clean of the forbidden value-path functions (the source-guard test is trivially satisfied -- request_secret calls the `requestSecretFromUser` dep, which only opens the modal + awaits a boolean).
- root-gated (the modal vaults to the open project's keychain namespace).
- Audited: the modal's save already audits `secret.set`; optionally also audit `secret.requested` (name only) when the agent asks.

## The round-trip wiring (new)
- main->renderer push channel `agent:request-secret` (requestId, name, providerHint).
- renderer->main invoke channel `agent:request-secret-resolved` (requestId, vaulted) -- resolves the pending promise by requestId.
- A main-side resolver registry (Map<requestId, {resolve, timer}>) + a timeout. Single in-flight is the common case (the agent awaits each tool call); a second concurrent request while one is pending returns `{ vaulted: false, busy: true }` (do not stack modals).
- The tool reaches this via a new dep `requestSecretFromUser(name, providerHint?): Promise<{ vaulted: boolean; timedOut?: boolean; busy?: boolean }>` threaded through McpDeps/ToolDeps (implemented in main near the MCP server wiring, since it needs the window + the renderer round-trip).

## Modal UX (reuse SecretModal)
- New modal variant, e.g. store `modal = { requestSecret: { requestId, name, providerHint } }`. SecretModal opens in add-mode with the name pre-filled + read-only, the "Claude is requesting..." note + the hint, the masked value field unchanged.
- On successful save: vault, send `agent:request-secret-resolved { requestId, vaulted: true }`, close.
- On cancel/backdrop/Escape: send `{ requestId, vaulted: false }`, close.
- The existing SecretModal "this value never reaches the AI model" caption is reused and is exactly right here.

## Tools registry change
`request_secret` becomes the 11th MCP tool; the allowlist guard updates to 11. root-gated. Registered in the same per-request `registerTools`.

## Out of scope (v1)
- The agent supplying a value (NO -- only the user provides it; the agent supplies the name + an optional hint).
- Auto-retrying the original action (the agent re-calls run_command itself after a successful vault).
- Stacking multiple concurrent requests (one in-flight; a second returns busy).
- Editing/overwriting an existing secret via this tool (it requests a name; if it already exists the modal behaves as the existing add/update flow does).
