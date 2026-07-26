import { useCallback, useEffect, useState } from "react";
import type { SlackAllowedChannel, SlackUiMessage } from "../../../shared/ipc";
import { useProjectTab } from "../lib/projectPane";
import { formatSlackTime } from "../lib/slackFormat";
import { useApp } from "../store";

// Glyph per conversation kind, mirroring convGlyph in main so the sidebar and
// the tool echo read the same.
function glyph(kind: string): string {
  if (kind === "im") return "@";
  if (kind === "mpim") return "👥";
  if (kind === "private") return "🔒";
  return "#";
}

interface ChannelState {
  loading: boolean;
  error?: string;
  messages?: SlackUiMessage[];
}

export function SlackSection() {
  const tabId = useProjectTab();
  const root = useApp((s) => s.tabState[tabId]?.root ?? null);
  const [channels, setChannels] = useState<SlackAllowedChannel[]>([]);
  const [connected, setConnected] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [state, setState] = useState<Record<string, ChannelState>>({});

  useEffect(() => {
    let cancelled = false;
    setChannels([]);
    setConnected(false);
    setExpanded(new Set());
    setState({});
    if (!root) return;
    void window.airlock
      .slackAllowedChannels(root)
      .then((c) => {
        if (cancelled) return;
        setChannels(c.channels);
        setConnected(c.connected);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [root]);

  const load = useCallback(
    async (id: string) => {
      if (!root) return;
      setState((s) => ({ ...s, [id]: { ...s[id], loading: true } }));
      const res = await window.airlock
        .slackReadChannel(root, id, 20)
        .catch((e: unknown) => ({
          error: e instanceof Error ? e.message : String(e),
          messages: undefined,
        }));
      setState((s) => ({
        ...s,
        [id]: { loading: false, error: res.error, messages: res.messages },
      }));
    },
    [root],
  );

  // Poll ONLY what is expanded, and only while the window is visible: a
  // backgrounded AirLock must not quietly hit Slack every 30s. Collapsed
  // channels cost nothing.
  useEffect(() => {
    if (!root || expanded.size === 0) return;
    const id = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      for (const channelId of expanded) void load(channelId);
    }, 30_000);
    return () => clearInterval(id);
  }, [root, expanded, load]);

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
        void load(id);
      }
      return next;
    });
  };

  // Not connected -> render nothing. The Extensions Hub owns connecting; a
  // second call-to-action here would just compete with it.
  if (!connected) return null;

  // Connected but nothing allow-listed is a DIFFERENT state: the user has one
  // action to take, and it is the allow-list modal.
  if (channels.length === 0) {
    return (
      <>
        <div className="sb-section-head">Slack</div>
        <button
          type="button"
          className="section-empty"
          onClick={() => useApp.getState().setModal("slack-channels")}
        >
          Pick channels Claude may read
        </button>
      </>
    );
  }

  return (
    <>
      <div className="sb-section-head">
        Slack <span className="sb-badge">{channels.length} allowed</span>
      </div>
      {channels.map((c) => {
        const open = expanded.has(c.id);
        const st = state[c.id];
        return (
          <div key={c.id} className="slack-channel">
            <button
              type="button"
              className="slack-channel-head"
              aria-expanded={open}
              onClick={() => toggle(c.id)}
            >
              <i
                className={`codicon codicon-chevron-${open ? "down" : "right"}`}
              />
              {`${glyph(c.kind)}${c.name}`}
            </button>
            {open && (
              <div className="slack-messages">
                {st?.loading && !st.messages && (
                  <div className="section-note">Loading…</div>
                )}
                {st?.error && <div className="section-note">{st.error}</div>}
                {st?.messages?.length === 0 && (
                  <div className="section-note">No messages</div>
                )}
                {st?.messages?.map((m) => (
                  <div key={m.ts} className="slack-msg">
                    <span className="slack-msg-time">
                      {formatSlackTime(m.ts, new Date())}
                    </span>
                    <span className="slack-msg-name">{m.userName}</span>
                    <span className="slack-msg-text">{m.text}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
