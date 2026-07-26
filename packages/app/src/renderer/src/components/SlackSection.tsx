import { useCallback, useEffect, useState } from "react";
import type { SlackAllowedChannel, SlackUiMessage } from "../../../shared/ipc";
import { useProjectTab } from "../lib/projectPane";
import {
  avatarHue,
  dayKey,
  formatDayLabel,
  formatSlackTime,
  initialsFor,
} from "../lib/slackFormat";
import { useApp } from "../store";

// Glyph per conversation kind, mirroring convGlyph in main so the sidebar and
// the tool echo read the same.
function glyph(kind: string): string {
  if (kind === "im") return "@";
  if (kind === "mpim") return "👥";
  if (kind === "private") return "🔒";
  return "#";
}

// Slack's join/leave notices are noise next to real conversation -- render them
// as a quiet single line instead of a full avatar+author block.
function isSystem(text: string): boolean {
  return /\b(has joined|has left|se ha unido|ha salido|joined the channel)\b/i.test(
    text,
  );
}

interface ChannelState {
  loading: boolean;
  error?: string;
  messages?: SlackUiMessage[];
}

// One rendered row: a day separator or a message that may or may not start a
// new author block. Computed once per render so the JSX stays flat.
interface Row {
  key: string;
  day?: string;
  msg?: SlackUiMessage;
  startsBlock?: boolean;
}

function buildRows(messages: SlackUiMessage[], now: Date): Row[] {
  // Slack returns newest-first; a transcript reads oldest-first.
  const ordered = [...messages].reverse();
  const rows: Row[] = [];
  let lastDay = "";
  let lastUser = "";
  for (const m of ordered) {
    const d = dayKey(m.ts);
    if (d && d !== lastDay) {
      rows.push({ key: `day-${d}`, day: formatDayLabel(m.ts, now) });
      lastDay = d;
      lastUser = ""; // a new day always restarts the author block
    }
    rows.push({
      key: m.ts,
      msg: m,
      startsBlock: m.user !== lastUser || isSystem(m.text),
    });
    lastUser = isSystem(m.text) ? "" : m.user;
  }
  return rows;
}

export function SlackSection() {
  const tabId = useProjectTab();
  const root = useApp((s) => s.tabState[tabId]?.root ?? null);
  const [channels, setChannels] = useState<SlackAllowedChannel[]>([]);
  const [connected, setConnected] = useState(false);
  const [loadedList, setLoadedList] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [state, setState] = useState<Record<string, ChannelState>>({});

  useEffect(() => {
    let cancelled = false;
    setChannels([]);
    setConnected(false);
    setLoadedList(false);
    setExpanded(new Set());
    setState({});
    if (!root) return;
    void window.airlock
      .slackAllowedChannels(root)
      .then((c) => {
        if (cancelled) return;
        setChannels(c.channels);
        setConnected(c.connected);
        setLoadedList(true);
      })
      .catch(() => {
        if (!cancelled) setLoadedList(true);
      });
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

  if (!loadedList) return <div className="section-note">Loading…</div>;

  // Not connected: point at the Hub, which owns connecting.
  if (!connected) {
    return (
      <div className="sb-card">
        <div className="section-note">
          Slack is not connected for this project.
        </div>
        <button
          type="button"
          className="btn primary"
          onClick={() => useApp.getState().setModal("connect-slack")}
        >
          Connect Slack
        </button>
      </div>
    );
  }

  // Connected but nothing allow-listed: one action, the allow-list modal.
  if (channels.length === 0) {
    return (
      <div className="sb-card">
        <div className="section-note">
          No channels allow-listed yet. Claude can read only what you pick here.
        </div>
        <button
          type="button"
          className="btn primary"
          onClick={() => useApp.getState().setModal("slack-channels")}
        >
          Pick channels Claude may read
        </button>
      </div>
    );
  }

  const now = new Date();
  return (
    <div className="slack-view">
      <div className="sb-section-head">
        Channels <span className="sb-badge">{channels.length} allowed</span>
      </div>
      {channels.map((c) => {
        const open = expanded.has(c.id);
        const st = state[c.id];
        const rows = st?.messages ? buildRows(st.messages, now) : [];
        return (
          <div key={c.id} className={`slack-channel${open ? " is-open" : ""}`}>
            <button
              type="button"
              className="slack-channel-head"
              aria-expanded={open}
              onClick={() => toggle(c.id)}
            >
              <i
                className={`codicon codicon-chevron-${open ? "down" : "right"}`}
              />
              <span className="slack-channel-glyph">{glyph(c.kind)}</span>
              <span className="slack-channel-name">{c.name}</span>
            </button>
            {open && (
              <div className="slack-thread">
                {st?.loading && !st.messages && (
                  <div className="section-note">Loading…</div>
                )}
                {st?.error && (
                  <div className="slack-refusal">
                    <i className="codicon codicon-warning" />
                    <span>{st.error}</span>
                  </div>
                )}
                {st?.messages?.length === 0 && (
                  <div className="section-note">No messages yet</div>
                )}
                {rows.map((row) =>
                  row.day ? (
                    <div key={row.key} className="slack-day">
                      <span>{row.day}</span>
                    </div>
                  ) : row.msg && isSystem(row.msg.text) ? (
                    <div key={row.key} className="slack-system">
                      {row.msg.text}
                    </div>
                  ) : row.msg ? (
                    <div
                      key={row.key}
                      className={`slack-msg${row.startsBlock ? " starts" : ""}`}
                    >
                      {row.startsBlock ? (
                        <span
                          className="slack-avatar"
                          style={{
                            background: `hsl(${avatarHue(row.msg.user || row.msg.userName)} 45% 38%)`,
                          }}
                        >
                          {initialsFor(row.msg.userName)}
                        </span>
                      ) : (
                        <span className="slack-avatar-spacer" />
                      )}
                      <div className="slack-msg-body">
                        {row.startsBlock && (
                          <div className="slack-msg-meta">
                            <span className="slack-msg-name">
                              {row.msg.userName}
                            </span>
                            <span className="slack-msg-time">
                              {formatSlackTime(row.msg.ts, now)}
                            </span>
                          </div>
                        )}
                        <div className="slack-msg-text">{row.msg.text}</div>
                      </div>
                    </div>
                  ) : null,
                )}
              </div>
            )}
          </div>
        );
      })}
      <div className="section-note slack-foot">
        Claude can read only these channels.
      </div>
    </div>
  );
}
