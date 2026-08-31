import type { Turn } from "@airlock/agent-core";
import { useEffect, useRef, useState } from "react";
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
}: {
  chrome?: boolean;
  reloadKey?: number;
} = {}) {
  const [turns, setTurns] = useState<Shown[]>([]);
  const [asked, setAsked] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [failed, setFailed] = useState(false);
  const [stopped, setStopped] = useState(false);
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
      setFailed(false);
      setAsked(false);
    }
    window.airlock
      ?.atlasTurns()
      .then((t) => {
        if (!alive) return;
        setTurns(t.map(withKey));
        setAsked(true);
      })
      .catch(() => {
        if (alive) setAsked(true);
      });
    return () => {
      alive = false;
    };
    // Re-runs when the host switches conversation (New chat, or resuming one
    // from History). Without this dep the prop was accepted and ignored, so
    // both buttons appeared to do nothing at all.
  }, [reloadKey]);

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
    const message = draft.trim();
    if (message.length === 0 || busy) return;
    const id = sendIdRef.current + 1;
    sendIdRef.current = id;
    // Show the user's turn immediately; the reply lands when it lands.
    const mine = withKey({ role: "user", text: message });
    pendingRef.current = { key: mine.key, text: message };
    setDraft("");
    setFailed(false);
    setStopped(false);
    setBusy(true);
    setTurns((prev) => [...prev, mine]);
    try {
      const reply = await window.airlock?.atlasSend(message);
      // Cancelled while we waited: whatever came back is not wanted, and a null
      // from a killed subprocess is not a failure to report.
      if (sendIdRef.current !== id) return;
      if (reply === null || reply === undefined) setFailed(true);
      else
        setTurns((prev) => [...prev, withKey({ role: "atlas", text: reply })]);
    } catch {
      if (sendIdRef.current === id) setFailed(true);
    } finally {
      if (sendIdRef.current === id) {
        pendingRef.current = null;
        setBusy(false);
      }
    }
  }

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
          {turns.length === 0 ? (
            <p className="atlas-chat-empty">
              Ask about your projects, or tell me something I should remember.
            </p>
          ) : (
            turns.map((t) => (
              <div key={t.key} className={`atlas-turn atlas-turn-${t.role}`}>
                {/* Atlas writes markdown; the user's text is shown as typed. */}
                {t.role === "atlas" ? renderBrief(t.text) : t.text}
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
          {failed ? (
            <div className="atlas-turn atlas-turn-error">
              Could not reach Claude. Your message is still here; try again.
            </div>
          ) : null}
          {stopped ? (
            <div className="atlas-chat-note">
              Stopped. Your message is back in the box.
            </div>
          ) : null}
          <div ref={endRef} />
        </div>
        <form onSubmit={submit} className="atlas-chat-form">
          <textarea
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
