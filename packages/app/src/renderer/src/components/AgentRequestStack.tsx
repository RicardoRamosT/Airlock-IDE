import { useState } from "react";
import {
  type AgentRequest,
  type LongRunningAppRequest,
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
//  - An expired SECRET card changes state visibly instead of vanishing, so the
//    user can tell why Claude gave up rather than finding a silent dead end.
//    This is deliberately NOT the rule for every kind: a terminal grant is
//    pruned on expiry (AGENT_REQUEST_POLICY.terminalGrant.actionableAfterExpiry
//    is false), because the send already returned timedOut and approving later
//    authorises nothing. Stating the rule as if it were universal, which this
//    comment used to do, reads as a bug in the grant path rather than the
//    documented asymmetry it is.
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

// Exported so the notification bell renders the SAME card, rather than a second
// implementation of "ask for a secret" that can drift from this one.
// `dismissible` is false in the bell: an item already there has been dismissed,
// so offering "Later" again would do nothing.
export function AgentRequestCard({
  request,
  dismissible = true,
}: {
  request: AgentRequest;
  dismissible?: boolean;
}) {
  if (request.kind === "secret")
    return <SecretCard request={request} dismissible={dismissible} />;
  if (request.kind === "longRunningApp")
    return <LongRunningAppCard request={request} dismissible={dismissible} />;
  return <GrantCard request={request} dismissible={dismissible} />;
}

/**
 * How long something has been up, in the coarsest unit that is still true.
 *
 * Deliberately coarse: this is a 24-hour threshold, so minutes are noise, and
 * "6 days" is what makes someone act. Rounds DOWN, so it never overstates.
 */
export function formatUptime(ms: number): string {
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.floor(hours / 24);
  return `${days} days`;
}

const APP_LABEL: Record<LongRunningAppRequest["appType"], string> = {
  container: "Container",
  managedServer: "Dev server",
  detectedServer: "Dev server",
};

// A passive OBSERVATION, not a request: nobody is waiting on it, so it offers
// an action and an acknowledgement and never blocks anything. "Later" here
// means "I know about this one" -- main remembers the identity so the poll does
// not raise it again, while a RESTART of the same app is a new identity and is
// reported afresh.
function LongRunningAppCard({
  request,
  dismissible,
}: {
  request: LongRunningAppRequest;
  dismissible: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const up = formatUptime(Date.now() - request.startedAt);

  const stop = async () => {
    setBusy(true);
    setError(null);
    const r = await window.airlock.localAppStop(request.requestId);
    if (!r.ok) {
      setError(r.error ?? "Could not stop it");
      setBusy(false);
    }
    // On success the card is removed by main; no need to unset busy.
  };

  return (
    <div className="agent-request-card">
      <div className="agent-request-title">{`Running for ${up}`}</div>
      <div className="agent-request-body">
        <div>
          <strong>{request.name}</strong>
        </div>
        {request.detail && (
          <div className="agent-request-note">{request.detail}</div>
        )}
        <div className="agent-request-note">
          {`${APP_LABEL[request.appType]}${
            request.projectName ? ` in ${request.projectName}` : ""
          }`}
        </div>
      </div>
      {error && <div className="agent-request-error">{error}</div>}
      <div className="agent-request-actions">
        <button
          type="button"
          className="btn primary"
          disabled={busy}
          onClick={() => void stop()}
        >
          {busy ? "Stopping..." : "Stop"}
        </button>
      </div>
      {dismissible && (
        <button
          type="button"
          className="agent-request-later"
          onClick={() =>
            void window.airlock.agentRequestDismiss(request.requestId)
          }
        >
          Later
        </button>
      )}
    </div>
  );
}

function CardShell({
  title,
  expiredNote,
  request,
  dismissible,
  children,
}: {
  title: string;
  expiredNote: string;
  request: AgentRequest;
  dismissible: boolean;
  children: React.ReactNode;
}) {
  const expired = request.state === "expired";
  return (
    <div className={`agent-request-card${expired ? " expired" : ""}`}>
      <div className="agent-request-title">{title}</div>
      {expired && <div className="agent-request-expired">{expiredNote}</div>}
      {children}
      {dismissible && (
        <button
          type="button"
          className="agent-request-later"
          onClick={() =>
            void window.airlock.agentRequestDismiss(request.requestId)
          }
        >
          Later
        </button>
      )}
    </div>
  );
}

function SecretCard({
  request,
  dismissible,
}: {
  request: SecretRequest;
  dismissible: boolean;
}) {
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
      expiredNote="Claude stopped waiting. You can still add this, then ask it to retry."
      request={request}
      dismissible={dismissible}
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

function GrantCard({
  request,
  dismissible,
}: {
  request: TerminalGrantRequest;
  dismissible: boolean;
}) {
  const respond = (granted: boolean) =>
    void window.airlock.terminalGrantResolve(request.requestId, granted);
  return (
    <CardShell
      title="Allow Claude to type into this terminal?"
      // A grant is pruned on expiry (approving it would authorise nothing), so
      // this note is a safety net rather than an expected state.
      expiredNote="Claude stopped waiting; this no longer applies."
      request={request}
      dismissible={dismissible}
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
