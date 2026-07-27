import { useCallback, useEffect, useRef, useState } from "react";
import type { SlackAllowedChannel } from "../../../shared/ipc";
import { openEditorFile } from "../lib/editorFiles";
import { useProjectTab } from "../lib/projectPane";
import {
  CHANNEL_CAP,
  cursorAt,
  FIRST_PAGE,
  filterChannels,
  PAGE_SIZE,
  type PageCursors,
  pageBack,
  pageForward,
  visibleChannels,
} from "../lib/slackList";
import { useApp } from "../store";
import { type ChannelState, SlackChannelRow } from "./SlackChannelRow";
import { SlackWorkspaceCard } from "./SlackWorkspaceCard";

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
  const [manageError, setManageError] = useState<string | null>(null);
  // Where each expanded channel sits in its history (cursor stack + index).
  const [pages, setPages] = useState<Record<string, PageCursors>>({});
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
    setManageError(null);
    setPages({});
    avatarsFor.current = null;
    void loadList();
  }, [loadList]);

  // Re-read when the config changes underneath us. Without this the list only
  // loaded on mount, so connecting a workspace or saving the channel allow-list
  // left the section stale until the user pressed Refresh -- and a workspace
  // that HAD been identified still read "unknown".
  useEffect(() => {
    if (!root) return;
    return window.airlock.onExtensionsChanged((e) => {
      if (e.root === root) void loadList();
    });
  }, [root, loadList]);

  const load = useCallback(
    async (id: string, cursor?: string) => {
      if (!root) return;
      setState((s) => ({ ...s, [id]: { ...s[id], loading: true } }));
      const res = await window.airlock
        .slackReadChannel(root, id, PAGE_SIZE, cursor)
        .catch((e: unknown) => ({
          error: e instanceof Error ? e.message : String(e),
          messages: undefined,
          nextCursor: undefined,
        }));
      setState((s) => ({
        ...s,
        [id]: {
          loading: false,
          error: res.error,
          messages: res.messages,
          nextCursor: res.nextCursor,
        },
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
      for (const channelId of expanded) {
        // Only refresh a channel sitting on the NEWEST page. New messages
        // arrive at page 1, and re-fetching page 4 every 30s would both waste
        // the call and yank someone reading history.
        if ((pages[channelId] ?? FIRST_PAGE).index !== 0) continue;
        void load(channelId);
      }
    }, 30_000);
    return () => clearInterval(id);
  }, [root, expanded, load, pages]);

  // Older = walk one page back through history using the cursor Slack returned
  // with the current page; Newer = pop back toward the most recent.
  const goOlder = (id: string) => {
    const next = state[id]?.nextCursor;
    if (!next) return;
    const p = pageForward(pages[id] ?? FIRST_PAGE, next);
    setPages((m) => ({ ...m, [id]: p }));
    void load(id, cursorAt(p));
  };
  const goNewer = (id: string) => {
    const p = pageBack(pages[id] ?? FIRST_PAGE);
    setPages((m) => ({ ...m, [id]: p }));
    void load(id, cursorAt(p));
  };

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

  // Removing is the SAFE direction of a permission change (Claude loses
  // access), so it is one click with no confirmation -- while granting access
  // still goes through the modal. Writes through the same path the modal uses,
  // so there is one way to mutate the allow-list.
  const removeChannel = async (id: string) => {
    if (!root) return;
    setManageError(null);
    const next = channels.filter((c) => c.id !== id);
    try {
      await window.airlock.extensionsSetConfig(root, "slack", {
        channels: next.map((c) => ({ id: c.id, name: c.name, kind: c.kind })),
      });
    } catch (e) {
      // Do NOT drop the row: showing a channel as un-shared while Claude can
      // still read it is a lie in the dangerous direction.
      setManageError(e instanceof Error ? e.message : String(e));
      return;
    }
    setChannels(next);
    setExpanded((prev) => {
      const s = new Set(prev);
      s.delete(id);
      return s;
    });
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
            // Refresh re-reads the page you are ON, not page 1: losing your
            // place in history is not what "refresh" should mean.
            for (const id of expanded)
              void load(id, cursorAt(pages[id] ?? FIRST_PAGE));
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
      {manageError && (
        <div className="slack-refusal">
          <i className="codicon codicon-warning" />
          <span>{manageError}</span>
        </div>
      )}
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
      {shown.map((c) => (
        <SlackChannelRow
          key={c.id}
          channel={c}
          open={expanded.has(c.id)}
          state={state[c.id]}
          page={(pages[c.id] ?? FIRST_PAGE).index}
          avatars={avatars}
          now={now}
          fileError={fileError}
          onToggle={() => toggle(c.id)}
          onRemove={() => void removeChannel(c.id)}
          onOlder={() => goOlder(c.id)}
          onNewer={() => goNewer(c.id)}
          onOpenFile={(fileId) => void openFile(c.id, fileId)}
        />
      ))}
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
