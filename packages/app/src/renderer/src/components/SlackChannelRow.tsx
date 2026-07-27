import type { SlackAllowedChannel, SlackUiMessage } from "../../../shared/ipc";
import {
  avatarHue,
  dayKey,
  formatDayLabel,
  formatSlackTime,
  initialsFor,
} from "../lib/slackFormat";
import { nextMessageLimit } from "../lib/slackList";

export // Glyph per conversation kind, mirroring convGlyph in main so the sidebar and
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

export interface ChannelState {
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

// One allow-listed channel: its head, its remove action and (when open) its
// thread. Split out of SlackSection so the section is composition and data
// loading only -- this file owns everything that is per-channel.
export function SlackChannelRow({
  channel,
  open,
  state,
  limit,
  avatars,
  now,
  fileError,
  onToggle,
  onRemove,
  onShowEarlier,
  onOpenFile,
}: {
  channel: SlackAllowedChannel;
  open: boolean;
  state?: ChannelState;
  limit: number;
  avatars: Record<string, string>;
  now: Date;
  fileError: string | null;
  onToggle: () => void;
  onRemove: () => void;
  onShowEarlier: () => void;
  onOpenFile: (fileId: string) => void;
}) {
  const st = state;
  const rows = st?.messages ? buildRows(st.messages, now) : [];
  return (
    <div className={`slack-channel${open ? " is-open" : ""}`}>
      <div className="slack-channel-head">
        <button
          type="button"
          className="slack-channel-toggle"
          aria-expanded={open}
          onClick={onToggle}
        >
          <i className={`codicon codicon-chevron-${open ? "down" : "right"}`} />
          <span className="slack-channel-glyph">{glyph(channel.kind)}</span>
          <span className="slack-channel-name">{channel.name}</span>
        </button>
        <button
          type="button"
          className="row-action reveal"
          title={`Stop sharing ${channel.name}`}
          onClick={onRemove}
        >
          <i className="codicon codicon-close" aria-hidden="true" />
        </button>
      </div>
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
          {st?.messages &&
            st.messages.length > 0 &&
            (nextMessageLimit(limit) === null ? (
              <div className="section-note">
                Showing the most recent 100 messages — the most AirLock fetches.
              </div>
            ) : (
              <button
                type="button"
                className="section-empty"
                onClick={onShowEarlier}
              >
                Show earlier
              </button>
            ))}
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
                      <span className="slack-msg-name">{row.msg.userName}</span>
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
                      onClick={() => onOpenFile(f.id)}
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
}
