import { useCallback, useEffect, useRef, useState } from "react";
import type { SlackAllowedChannel, SlackUiMessage } from "../../../shared/ipc";
import { openEditorFile } from "../lib/editorFiles";
import { useProjectTab } from "../lib/projectPane";
import {
  avatarHue,
  dayKey,
  formatDayLabel,
  formatSlackTime,
  initialsFor,
} from "../lib/slackFormat";
import { CHANNEL_CAP, filterChannels, visibleChannels } from "../lib/slackList";
import { useApp } from "../store";
import { SlackWorkspaceCard } from "./SlackWorkspaceCard";

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

// How long a silence ends an author block. Slack uses ~5 minutes: without this,
// two messages from one person hours apart share a single header and the later
// one silently inherits the earlier timestamp.
const BLOCK_GAP_SECONDS = 5 * 60;

function buildRows(messages: SlackUiMessage[], now: Date): Row[] {
  // Slack returns newest-first; a transcript reads oldest-first.
  const ordered = [...messages].reverse();
  const rows: Row[] = [];
  let lastDay = "";
  let lastUser = "";
  let lastAt = Number.NaN;
  for (const m of ordered) {
    const d = dayKey(m.ts);
    if (d && d !== lastDay) {
      rows.push({ key: `day-${d}`, day: formatDayLabel(m.ts, now) });
      lastDay = d;
      lastUser = ""; // a new day always restarts the author block
    }
    const at = Number.parseFloat(m.ts);
    const gapped =
      !Number.isFinite(lastAt) ||
      !Number.isFinite(at) ||
      at - lastAt > BLOCK_GAP_SECONDS;
    rows.push({
      key: m.ts,
      msg: m,
      startsBlock: m.user !== lastUser || gapped || isSystem(m.text),
    });
    lastUser = isSystem(m.text) ? "" : m.user;
    lastAt = at;
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
  const [fileError, setFileError] = useState<string | null>(null);
  // userId -> data URL. Empty until loaded, and stays empty without users:read
  // -- the initials circle below is the fallback, so this only ever upgrades.
  const [avatars, setAvatars] = useState<Record<string, string>>({});
  const [workspace, setWorkspace] = useState<
    { id: string; name: string } | undefined
  >(undefined);
  const [filter, setFilter] = useState("");
  const [showAll, setShowAll] = useState(false);
  // Loaded once per project, on the first read that actually succeeds -- which
  // is also the first moment we know Slack is connected. Keyed on the root so
  // connecting (or switching workspaces) mid-session still picks pictures up.
  const avatarsFor = useRef<string | null>(null);

  // Extracted so Refresh can re-read the LIST too: a channel added in the
  // modal, or a workspace switched in another window, should appear without
  // reopening the project.
  const loadList = useCallback(async () => {
    if (!root) return;
    const c = await window.airlock.slackAllowedChannels(root).catch(() => null);
    if (!c) {
      setLoadedList(true);
      return;
    }
    setChannels(c.channels);
    setConnected(c.connected);
    setWorkspace(c.workspace);
    setLoadedList(true);
  }, [root]);

  useEffect(() => {
    setChannels([]);
    setConnected(false);
    setLoadedList(false);
    setExpanded(new Set());
    setState({});
    setAvatars({});
    setWorkspace(undefined);
    setFilter("");
    setShowAll(false);
    avatarsFor.current = null;
    void loadList();
  }, [loadList]);

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
      if (res.messages && avatarsFor.current !== root) {
        avatarsFor.current = root;
        window.airlock
          .slackAvatars(root)
          .then(setAvatars)
          .catch(() => {});
      }
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

  // Download through the gated main-side path, then hand the cached path to the
  // normal editor open -- so the existing image/PDF viewers and tab machinery
  // are reused rather than duplicated in a 260px sidebar.
  const openFile = async (channelId: string, fileId: string) => {
    if (!root) return;
    setFileError(null);
    const res = await window.airlock
      .slackDownloadFile(root, channelId, fileId)
      .catch((e: unknown) => ({
        error: e instanceof Error ? e.message : String(e),
        relPath: undefined,
      }));
    if (res.error || !res.relPath) {
      setFileError(res.error ?? "Could not open that file.");
      return;
    }
    // Check the result: main can refuse a path, and a swallowed refusal is
    // exactly what made this chip look inert before.
    const opened = await openEditorFile(tabId, res.relPath);
    if (!opened) setFileError("Could not open that file.");
  };

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
  const filtering = filter.trim() !== "";
  const matches = filterChannels(channels, filter);
  const { shown, hidden } = visibleChannels(matches, {
    filtering,
    showAll,
    cap: CHANNEL_CAP,
  });
  return (
    <div className="slack-view">
      <div className="section-toolbar">
        <button
          type="button"
          className="btn"
          title="Refresh"
          onClick={() => {
            void loadList();
            for (const id of expanded) void load(id);
          }}
        >
          Refresh
        </button>
        <button
          type="button"
          className="btn"
          title="Manage channels"
          onClick={() => useApp.getState().setModal("slack-channels")}
        >
          Channels
        </button>
        <button
          type="button"
          className="btn"
          title="Collapse all"
          disabled={expanded.size === 0}
          onClick={() => setExpanded(new Set())}
        >
          Collapse
        </button>
      </div>
      <SlackWorkspaceCard workspace={workspace} />
      <input
        className="sb-control"
        type="text"
        placeholder="Filter channels…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      <div className="sb-section-head">
        Channels <span className="sb-badge">{channels.length} allowed</span>
      </div>
      {shown.length === 0 && filtering && (
        <div className="section-note">No channels match “{filter.trim()}”.</div>
      )}
      {shown.map((c) => {
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
                {fileError && (
                  <div className="slack-refusal">
                    <i className="codicon codicon-warning" />
                    <span>{fileError}</span>
                  </div>
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
                        avatars[row.msg.user] ? (
                          <img
                            className="slack-avatar"
                            src={avatars[row.msg.user]}
                            alt=""
                          />
                        ) : (
                          <span
                            className="slack-avatar"
                            style={{
                              background: `hsl(${avatarHue(row.msg.user || row.msg.userName)} 45% 38%)`,
                            }}
                          >
                            {initialsFor(row.msg.userName)}
                          </span>
                        )
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
                        {row.msg.text && (
                          <div className="slack-msg-text">{row.msg.text}</div>
                        )}
                        {row.msg.files.map((f) => (
                          <button
                            key={f.id}
                            type="button"
                            className="slack-file"
                            title={`Open ${f.name}`}
                            onClick={() => void openFile(c.id, f.id)}
                          >
                            <i
                              className={`codicon codicon-${f.kind === "image" ? "file-media" : "file"}`}
                            />
                            <span className="slack-file-name">{f.name}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null,
                )}
              </div>
            )}
          </div>
        );
      })}
      {hidden > 0 && (
        <button
          type="button"
          className="section-empty"
          onClick={() => setShowAll(true)}
        >
          … {hidden} more · show all
        </button>
      )}
      <div className="section-note slack-foot">
        Claude can read only these channels.
      </div>
    </div>
  );
}
