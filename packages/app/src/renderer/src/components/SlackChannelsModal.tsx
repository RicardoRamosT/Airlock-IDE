import { useEffect, useState } from "react";
import type { SlackAllowedChannel } from "../../../shared/ipc";
import { useProjectTab } from "../lib/projectPane";
import { mergeAllowList, unlistedCount } from "../lib/slackAllowList";
import { useApp } from "../store";

import { Loading } from "./Loading";

type Channel = {
  id: string;
  name: string;
  kind: "public" | "private" | "im" | "mpim";
};

// The Slack permission wall: pick which channels Claude may read for THIS
// project. Loads every channel the token can see + the current allow-list, and
// saves the checked set to per-project config. Nothing outside this set is
// reachable by the slack_read_channel MCP tool.
export function SlackChannelsModal() {
  const setModal = useApp((s) => s.setModal);
  const tabId = useProjectTab();
  const root = useApp((s) => s.tabState[tabId]?.root ?? null);
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // The allow-list as stored, kept so a save can preserve entries this picker
  // cannot display (DMs when includePrivate is off, or a partial fetch).
  const [current, setCurrent] = useState<SlackAllowedChannel[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!root) return;
    let cancelled = false;
    void (async () => {
      try {
        const [all, cfg] = await Promise.all([
          window.airlock.extensionsSlackChannels(root),
          window.airlock.extensionsGetConfig(root, "slack"),
        ]);
        if (cancelled) return;
        setChannels(all);
        const cur = Array.isArray(cfg.channels) ? cfg.channels : [];
        setCurrent(
          cur.filter(
            (x): x is SlackAllowedChannel =>
              !!x &&
              typeof x === "object" &&
              typeof (x as { id?: unknown }).id === "string",
          ),
        );
        const ids = new Set(
          cur
            .map((c) =>
              c && typeof c === "object"
                ? (c as { id?: unknown }).id
                : undefined,
            )
            .filter((id): id is string => typeof id === "string"),
        );
        setSelected(ids);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [root]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const save = async () => {
    if (busy || !root || !channels) return;
    setBusy(true);
    setError(null);
    try {
      // NOT `channels.filter(...)`: the picker only lists what
      // conversations.list returned, so filtering against it DELETED
      // allow-listed conversations it could not show -- observed as three DMs
      // vanishing from a six-channel allow-list the user never edited.
      const allow = mergeAllowList(channels, selected, current);
      await window.airlock.extensionsSetConfig(root, "slack", {
        channels: allow,
      });
      setModal(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-title">Allowed Slack channels</div>
        <div className="modal-caption">
          Claude can read ONLY the channels you check here. Everything else is
          unreachable.
        </div>
        {error && <div className="modal-error">{error}</div>}
        {/* A preserved-but-invisible entry is better than a deleted one, but
            neither should be unmentioned: say what this list cannot show. */}
        {channels !== null && unlistedCount(channels, current) > 0 && (
          <div className="section-note">
            {unlistedCount(channels, current)} allow-listed conversation
            {unlistedCount(channels, current) === 1 ? "" : "s"} (DMs or private
            channels) are not listed here and will be kept. Remove them from the
            Slack sidebar.
          </div>
        )}
        <div className="slack-channel-list">
          {channels === null ? (
            <Loading label="Loading channels" />
          ) : channels.length === 0 ? (
            <div className="section-note">
              No channels found (is Slack connected?).
            </div>
          ) : (
            channels.map((c) => (
              <label key={c.id} className="slack-channel-row">
                <input
                  type="checkbox"
                  checked={selected.has(c.id)}
                  onChange={() => toggle(c.id)}
                />
                <span>
                  {c.kind === "im"
                    ? "@ "
                    : c.kind === "mpim"
                      ? "👥 "
                      : c.kind === "private"
                        ? "🔒 "
                        : "#"}
                  {c.name}
                </span>
              </label>
            ))
          )}
        </div>
        <div className="modal-actions">
          <button
            type="button"
            className="btn"
            onClick={() => setModal(null)}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={save}
            disabled={busy || channels === null}
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
