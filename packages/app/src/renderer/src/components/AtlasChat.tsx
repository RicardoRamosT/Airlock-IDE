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
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let alive = true;
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
    setDraft("");
    setFailed(false);
    setBusy(true);
    // Show the user's turn immediately; the reply lands when it lands.
    setTurns((prev) => [...prev, withKey({ role: "user", text: message })]);
    try {
      const reply = await window.airlock?.atlasSend(message);
      if (reply === null || reply === undefined) setFailed(true);
      else
        setTurns((prev) => [...prev, withKey({ role: "atlas", text: reply })]);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
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
          <div ref={endRef} />
        </div>
        <form onSubmit={submit} className="atlas-chat-form">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Ask, or tell me something..."
            aria-label="Message Atlas"
          />
        </form>
      </div>
    </div>
  );
}
