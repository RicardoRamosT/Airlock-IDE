import { useState } from "react";
import {
  type AgentRequest,
  partitionRequests,
  type SecretRequest,
  type TerminalGrantRequest,
} from "../../../shared/agentRequests";
import { useAgentRequests } from "../lib/useAgentRequests";
import { useVaultSecret } from "../lib/useVaultSecret";
import { useApp } from "../store";

// Non-blocking cards in the bottom-right corner for anything the AGENT asks for.
// A dialog the user did not open should not seize the window, so nothing here
// steals focus, captures Escape, or renders a backdrop.
//
// Two rules this file must not break:
//  - NEVER auto-dismiss. A normal toast fades; a pending request must not, or the
//    agent waits on something the user never saw.
//  - An EXPIRED card changes state visibly instead of vanishing, so the user can
//    tell why Claude gave up rather than finding a silent dead end.
export function AgentRequestStack() {
  const requests = useAgentRequests();
  const { stack, overflow } = partitionRequests(requests);
  if (stack.length === 0) return null;
  return (
    // column-reverse so the newest card sits nearest the corner and older ones
    // push upward. aria-live=polite announces without moving focus.
    <div className="agent-request-stack" aria-live="polite">
      {overflow > 0 && (
        <div className="agent-request-overflow">{`+${overflow} more in the bell`}</div>
      )}
      {stack.map((r) => (
        <AgentRequestCard key={r.requestId} request={r} />
      ))}
    </div>
  );
}

function AgentRequestCard({ request }: { request: AgentRequest }) {
  return request.kind === "secret" ? (
    <SecretCard request={request} />
  ) : (
    <GrantCard request={request} />
  );
}

function CardShell({
  title,
  expiredNote,
  request,
  children,
}: {
  title: string;
  expiredNote: string;
  request: AgentRequest;
  children: React.ReactNode;
}) {
  const expired = request.state === "expired";
  return (
    <div className={`agent-request-card${expired ? " expired" : ""}`}>
      <div className="agent-request-title">{title}</div>
      {expired && <div className="agent-request-expired">{expiredNote}</div>}
      {children}
      <button
        type="button"
        className="agent-request-later"
        onClick={() =>
          void window.airlock.agentRequestDismiss(request.requestId)
        }
      >
        Later
      </button>
    </div>
  );
}

function SecretCard({ request }: { request: SecretRequest }) {
  const { save, busy } = useVaultSecret();
  const setSecrets = useApp((s) => s.setSecrets);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const root = request.root;
    if (!root) {
      setError("This request has no project to vault into.");
      return;
    }
    setError(null);
    const r = await save(root, request.name, value);
    if (!r.ok) {
      setError(r.error ?? "Could not save.");
      return;
    }
    // Saved. The agent is awaiting a boolean -- report it even when the value
    // looks unusual, and never strand it on a warning.
    await window.airlock.requestSecretResolve(request.requestId, true);
    setSecrets(await window.airlock.secretsList(root));
  };

  return (
    <CardShell
      title={
        request.projectName
          ? `Claude needs ${request.name} for ${request.projectName}`
          : `Claude needs ${request.name}`
      }
      expiredNote="Claude stopped waiting — you can still add this, then ask it to retry."
      request={request}
    >
      <input
        type="password"
        className="agent-request-input"
        placeholder="Paste the value"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        spellCheck={false}
      />
      {request.providerHint && (
        <div className="agent-request-hint">{request.providerHint}</div>
      )}
      {error && <div className="agent-request-error">{error}</div>}
      <div className="agent-request-actions">
        <button
          type="button"
          className="btn primary"
          onClick={submit}
          disabled={busy || value === ""}
        >
          {busy ? "Saving…" : "Vault it"}
        </button>
      </div>
      <div className="agent-request-note">
        Stored in your keychain. Claude never sees the value.
      </div>
    </CardShell>
  );
}

function GrantCard({ request }: { request: TerminalGrantRequest }) {
  const respond = (granted: boolean) =>
    void window.airlock.terminalGrantResolve(request.requestId, granted);
  return (
    <CardShell
      title="Allow Claude to type into this terminal?"
      // A grant is pruned on expiry (approving it would authorise nothing), so
      // this note is a safety net rather than an expected state.
      expiredNote="Claude stopped waiting; this no longer applies."
      request={request}
    >
      <div className="agent-request-hint">
        In <strong>{request.label}</strong>
      </div>
      <code className="agent-request-preview">
        {request.preview || "(empty)"}
      </code>
      <div className="agent-request-note">
        Allowing lets Claude type anything into this terminal for the rest of
        the session, including commands that run with this project's injected
        secrets.
      </div>
      <div className="agent-request-actions">
        <button type="button" className="btn" onClick={() => respond(false)}>
          Deny
        </button>
        <button
          type="button"
          className="btn primary"
          onClick={() => respond(true)}
        >
          Allow
        </button>
      </div>
    </CardShell>
  );
}
