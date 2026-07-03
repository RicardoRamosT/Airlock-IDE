import { useEffect, useState } from "react";
import { useProjectTab } from "../lib/projectPane";
import { useApp } from "../store";

type Channel = { id: string; name: string; isPrivate: boolean };

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
      const allow = channels
        .filter((c) => selected.has(c.id))
        .map((c) => ({ id: c.id, name: c.name }));
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
        <div className="slack-channel-list">
          {channels === null ? (
            <div className="section-note">Loading channels…</div>
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
                  {c.isPrivate ? "🔒 " : "#"}
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
