import type { Turn } from "@airlock/agent-core";
import { useCallback, useEffect, useRef, useState } from "react";
import { renderBrief } from "../lib/atlasBrief";
import { formatElapsed } from "../lib/atlasFormat";

// The Atlas conversation. Read-only in the sense that Atlas cannot change any
// repository from here -- acting is Plan 4. This window is separate from the
// project window on purpose, so the user can work and talk at the same time.
// Turns carry a locally-assigned key. An array index is not a safe key here:
// the user's turn is appended optimistically and the reply lands afterwards, so
// React would reuse state across two different messages at the same position.
interface Shown extends Turn {
  key: string;
}

// Module scope so the helper has a stable identity and never becomes a hook
// dependency. Keys only need to be unique within one mounted list; a monotonic
// counter gives that and more.
let keySeq = 0;
function withKey(t: Turn): Shown {
  keySeq += 1;
  return { ...t, key: `t${keySeq}` };
}

export function AtlasChat({
  chrome = true,
  reloadKey = 0,
  ask = null,
}: {
  chrome?: boolean;
  reloadKey?: number;
  // A question handed in from outside -- "look into this concern". The nonce is
  // what makes asking about the SAME concern twice send twice.
  ask?: { text: string; n: number } | null;
} = {}) {
  const [turns, setTurns] = useState<Shown[]>([]);
  const [asked, setAsked] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  // The REASON, not a boolean: main knows exactly why a run ended and used
  // to keep it to itself. null = no failure.
  const [failed, setFailed] = useState<string | null>(null);
  // Images pasted into the box, not yet sent. Paths, not bytes: main has
  // already written the file, so this survives a re-render for free.
  const [attached, setAttached] = useState<string[]>([]);
  // Mirrored into a ref because submitText is a useCallback that deliberately
  // depends only on `busy`; adding `attached` would rebuild it on every paste
  // and re-fire the handed-in-question effect that depends on it.
  const attachedRef = useRef<string[]>([]);
  attachedRef.current = attached;
  const [stopped, setStopped] = useState(false);
  // The FOURTH state. "Asked and empty" and "asked and it failed" are different
  // answers, and rendering the empty-conversation prompt for a failed read told
  // the user their history had been deleted.
  const [loadFailed, setLoadFailed] = useState(false);
  // Read by the refresh subscriber, which is registered once and would
  // otherwise close over the first render's `busy`.
  const busyRef = useRef(false);
  // Which message was just copied, so the click is confirmed rather than silent.
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const endRef = useRef<HTMLDivElement | null>(null);
  const boxRef = useRef<HTMLTextAreaElement | null>(null);
  // Identifies the in-flight send. Escape bumps it, which is what tells the
  // awaiting continuation that its result is no longer wanted -- without this a
  // cancelled call would still land, either appending a reply the user stopped
  // or claiming a failure that never happened.
  const sendIdRef = useRef(0);
  const pendingRef = useRef<{ key: string; text: string } | null>(null);

  useEffect(() => {
    let alive = true;
    // A non-zero reloadKey means the host switched conversation (New chat, or
    // resuming one from History). Drop the visible transcript at once, so the
    // previous conversation does not linger on screen while the new one loads.
    if (reloadKey > 0) {
      setTurns([]);
      setFailed(null);
      setAsked(false);
    }
    if (retryNonce > 0) {
      // Show the loading state again rather than leaving "could not load" up
      // while the refetch is in flight. This also makes retryNonce a real
      // dependency of the effect instead of a bare re-run marker.
      setLoadFailed(false);
      setAsked(false);
    }
    window.airlock
      ?.atlasTurns()
      .then((t) => {
        if (!alive) return;
        setTurns(t.map(withKey));
        setLoadFailed(false);
        setAsked(true);
      })
      .catch(() => {
        if (!alive) return;
        setLoadFailed(true);
        setAsked(true);
      });
    return () => {
      alive = false;
    };
    // Re-runs when the host switches conversation (New chat, or resuming one
    // from History). Without this dep the prop was accepted and ignored, so
    // both buttons appeared to do nothing at all.
  }, [reloadKey, retryNonce]);

  // Refetch when main says a run finished ANYWHERE.
  //
  // A panel that loaded a PENDING turn had no way to learn it had settled: it
  // was not the renderer that made the call, so no promise resolved here, and
  // atlas:refresh only fired when the popover opened. The result was "Atlas is
  // working on this..." left up permanently over a reply that had landed
  // minutes earlier and was sitting in the database.
  //
  // Skipped while THIS window is busy: it appends its own reply optimistically
  // when the call resolves, and refetching under that would race the append and
  // could show the reply twice.
  useEffect(() => {
    const off = window.airlock?.onAtlasRefresh?.(() => {
      if (busyRef.current) return;
      setRetryNonce((n) => n + 1);
    });
    return () => {
      if (typeof off === "function") off();
    };
  }, []);

  // Follow the conversation: when a turn arrives, or the reply finishes, put
  // the newest message in view. Keyed on the turn count and the busy flag
  // rather than every render, so it does not fight the user scrolling back
  // while nothing is happening.
  useEffect(() => {
    // Nothing to follow in an empty conversation, and scrolling it would fight
    // the empty-state message.
    if (turns.length === 0 && !busy) return;
    // Optional call: jsdom has no scrollIntoView.
    endRef.current?.scrollIntoView?.({ block: "end", behavior: "smooth" });
  }, [turns.length, busy]);

  // Grow with the message instead of scrolling sideways, up to a ceiling so the
  // composer can never swallow the transcript.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    // Reset first, or the box can only ever GROW: scrollHeight is measured
    // against the height already applied.
    el.style.height = "auto";
    const wanted = draft.length === 0 ? 32 : Math.min(el.scrollHeight, 160);
    el.style.height = `${Math.max(32, wanted)}px`;
  }, [draft]);

  // A bare "..." says nothing about whether anything is happening. Atlas runs a
  // real subprocess that can take many seconds, so show the stage AND a running
  // clock -- the difference between "working" and "hung" has to be visible.
  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  useEffect(() => {
    if (!busy) return;
    setElapsed(0);
    const started = Date.now();
    const id = setInterval(
      () => setElapsed(Math.round((Date.now() - started) / 1000)),
      1000,
    );
    return () => clearInterval(id);
  }, [busy]);

  async function submit(e: { preventDefault: () => void }) {
    e.preventDefault();
    await submitText(draft);
  }

  // useCallback so the handed-in-question effect below can depend on it
  // honestly. `busy` is the only reactive value it reads; the setters and refs
  // are stable.
  const submitText = useCallback(
    async (raw: string) => {
      const message = raw.trim();
      // An image on its own is a complete message ("what is wrong here?" is
      // often the screenshot), so attachments alone may be sent.
      const files = attachedRef.current;
      if ((message.length === 0 && files.length === 0) || busy) return;
      const id = sendIdRef.current + 1;
      sendIdRef.current = id;
      // Show the user's turn immediately; the reply lands when it lands.
      const shown =
        message.length > 0
          ? message
          : files.length === 1
            ? "(screenshot)"
            : `(${files.length} screenshots)`;
      const mine = withKey({ role: "user", text: shown });
      pendingRef.current = { key: mine.key, text: shown };
      setDraft("");
      setAttached([]);
      setFailed(null);
      setStopped(false);
      setBusy(true);
      setTurns((prev) => [...prev, mine]);
      try {
        const reply = await window.airlock?.atlasSend(message, files);
        // Cancelled while we waited: whatever came back is not wanted, and a
        // null from a killed subprocess is not a failure to report.
        if (sendIdRef.current !== id) return;
        if (reply === null || reply === undefined)
          setFailed("Could not reach Claude.");
        else if (!reply.ok) setFailed(reply.error);
        else
          setTurns((prev) => [
            ...prev,
            withKey({ role: "atlas", text: reply.text }),
          ]);
      } catch {
        if (sendIdRef.current === id) setFailed("Could not reach Claude.");
      } finally {
        if (sendIdRef.current === id) {
          pendingRef.current = null;
          setBusy(false);
        }
      }
    },
    [busy],
  );

  // Escape stops the run. It kills the SUBPROCESS rather than only stopping the
  // wait: an abandoned `claude` keeps spending quota with nowhere to deliver.
  function cancel() {
    if (!busy) return;
    const p = pendingRef.current;
    sendIdRef.current += 1; // invalidates the in-flight continuation
    pendingRef.current = null;
    void window.airlock?.atlasCancel?.();
    setBusy(false);
    setStopped(true);
    // Hand the message back and drop the optimistic turn. Nothing was stored,
    // so leaving it in the log would show a question that no longer exists --
    // and retyping it is exactly what someone stopping a wrong question does
    // not want to do.
    if (p) {
      setDraft(p.text);
      setTurns((prev) => prev.filter((t) => t.key !== p.key));
    }
  }

  // Send a handed-in question once per nonce. Keyed on the nonce alone: the
  // text may repeat, and re-sending because a parent re-rendered would fire a
  // second Opus run the user never asked for.
  const askedRef = useRef(0);
  useEffect(() => {
    if (!ask || ask.n === askedRef.current) return;
    askedRef.current = ask.n;
    void submitText(ask.text);
    // submitText is redeclared every render, so this effect re-runs often --
    // which is harmless, because askedRef makes it idempotent. The nonce is the
    // real trigger; the dependency is declared rather than suppressed so the
    // rule keeps working for the next person to touch this.
  }, [ask, submitText]);

  // Cmd+V of a screenshot. `claude -p` takes text, so the bytes go to a file
  // main owns and the path rides along with the message; Atlas opens it with
  // Read. Non-image pastes fall through untouched to the normal text paste.
  async function onPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(e.clipboardData?.items ?? [])
      .filter((i) => i.kind === "file" && i.type.startsWith("image/"))
      .map((i) => i.getAsFile())
      .filter((f): f is File => f !== null);
    if (files.length === 0) return;
    e.preventDefault();
    for (const f of files) {
      try {
        const buf = new Uint8Array(await f.arrayBuffer());
        const path = await window.airlock?.atlasAttach(buf, f.type);
        if (path) setAttached((prev) => [...prev, path]);
      } catch {
        // A failed attach must not eat the paste or break the box.
      }
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Escape") {
      if (!busy) return; // idle Escape belongs to the host window
      e.preventDefault();
      e.stopPropagation(); // stopping a reply must not also close the popover
      cancel();
      return;
    }
    // Enter sends, Shift+Enter makes a newline. isComposing guards IME input,
    // where Enter commits a candidate and does not mean "send".
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      void submit(e);
    }
  }

  // titleBarStyle is hiddenInset, so the traffic lights float over the content.
  // This bar reserves their space and carries the drag region.
  const titlebar = !chrome ? null : (
    <div className="atlas-titlebar">
      <span className="atlas-mark" aria-hidden="true">
        &#10022;
      </span>
      <h1>Atlas</h1>
    </div>
  );

  // Three states: not asked yet, asked and empty, asked and populated.
  if (!asked) {
    return (
      <div className="atlas-window">
        {titlebar}
        <div className="atlas-chat">
          <div className="atlas-chat-log">
            <p className="atlas-chat-empty">Loading...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="atlas-window">
      {titlebar}
      <div className="atlas-chat">
        <div className="atlas-chat-log">
          {loadFailed ? (
            <div className="atlas-chat-empty">
              <p>
                Could not load this conversation. Nothing has been deleted -- it
                is still stored.
              </p>
              <button
                type="button"
                className="atlas-btn"
                onClick={() => setRetryNonce((n) => n + 1)}
              >
                Try again
              </button>
            </div>
          ) : turns.length === 0 ? (
            <p className="atlas-chat-empty">
              Ask about your projects, or tell me something I should remember.
            </p>
          ) : (
            turns.map((t) => (
              <div key={t.key} className="atlas-turn-wrap">
                <div className={`atlas-turn atlas-turn-${t.role}`}>
                  {/* Atlas writes markdown; the user's text is shown as typed. */}
                  {t.role === "atlas" ? renderBrief(t.text) : t.text}
                </div>
                <button
                  type="button"
                  className="atlas-copy"
                  title="Copy this message"
                  onClick={() => {
                    // The RAW text, not the rendered DOM. Atlas writes
                    // markdown and a copy is usually headed somewhere that
                    // understands it -- copying the rendering would strip the
                    // headings, bold and code fences back to flat prose.
                    void navigator.clipboard
                      ?.writeText(t.text)
                      .then(() => setCopiedKey(t.key))
                      .catch((err) => console.error("copy failed", err));
                  }}
                >
                  {copiedKey === t.key ? "Copied" : "Copy"}
                </button>
                {/* A question's answer state, which only the STORE knows after a
                    reopen -- `busy` belongs to the renderer that asked, and that
                    renderer is gone. Without this the message came back with no
                    sign anything was happening. */}
                {t.pending === "pending" ? (
                  <div className="atlas-chat-note">
                    Atlas is working on this...
                  </div>
                ) : t.pending === "unanswered" ? (
                  <div className="atlas-chat-note">
                    This was never answered - Atlas was interrupted.
                  </div>
                ) : null}
              </div>
            ))
          )}
          {busy ? (
            <div className="atlas-thinking" aria-live="polite">
              <span className="atlas-thinking-dots" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              <span>
                {elapsed < 3
                  ? "Reading your portfolio\u2026"
                  : elapsed < 10
                    ? "Thinking\u2026"
                    : "Still thinking\u2026"}
              </span>
              {elapsed >= 3 ? (
                <span className="atlas-thinking-time">
                  {formatElapsed(elapsed)}
                </span>
              ) : null}
            </div>
          ) : null}
          {failed !== null ? (
            <div className="atlas-turn atlas-turn-error">
              {failed} Your message is still here; try again.
            </div>
          ) : null}
          {stopped ? (
            <div className="atlas-chat-note">
              Stopped. Your message is back in the box.
            </div>
          ) : null}
          <div ref={endRef} />
        </div>
        {attached.length > 0 ? (
          <div className="atlas-attachments">
            {attached.map((p) => (
              <span key={p} className="atlas-attachment">
                <i className="codicon codicon-device-camera" />
                Screenshot
                <button
                  type="button"
                  aria-label="Remove screenshot"
                  onClick={() =>
                    setAttached((prev) => prev.filter((x) => x !== p))
                  }
                >
                  <i className="codicon codicon-close" />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <form onSubmit={submit} className="atlas-chat-form">
          <textarea
            onPaste={onPaste}
            ref={boxRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder={
              busy
                ? "Esc to stop"
                : "Ask, or tell me something...  (Shift+Enter for a new line)"
            }
            aria-label="Message Atlas"
          />
        </form>
      </div>
    </div>
  );
}
