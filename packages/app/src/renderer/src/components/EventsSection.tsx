import { useCallback, useEffect, useState } from "react";
import type { LogEvent } from "../../../shared/ipc";
import { startFocusPolling } from "../lib/focusPolling";

const POLL_MS = 3000;
const LIMIT = 100;
const LEVELS = ["debug", "info", "warn", "error"] as const;

function shortTime(iso: string): string {
  return iso.slice(11, 19);
}

export function EventsSection() {
  const [events, setEvents] = useState<LogEvent[]>([]);
  const [level, setLevel] = useState<(typeof LEVELS)[number]>("debug");
  const [category, setCategory] = useState<string>("");

  const load = useCallback(() => {
    window.airlock
      .eventsQuery({ level, category: category || undefined, limit: LIMIT })
      .then((e) => setEvents(e.slice().reverse()))
      .catch(() => {});
  }, [level, category]);

  useEffect(() => {
    load();
    return startFocusPolling(load, POLL_MS, {
      hasFocus: () => document.hasFocus(),
      setInterval: (fn, ms) => window.setInterval(fn, ms),
      clearInterval: (id) => window.clearInterval(id),
      addEventListener: (type, fn) => window.addEventListener(type, fn),
      removeEventListener: (type, fn) => window.removeEventListener(type, fn),
    });
  }, [load]);

  const categories = Array.from(new Set(events.map((e) => e.category))).sort();

  return (
    <div className="events">
      <div className="section-toolbar">
        <select
          className="sb-control"
          value={level}
          onChange={(e) => setLevel(e.target.value as (typeof LEVELS)[number])}
        >
          {LEVELS.map((l) => (
            <option key={l} value={l}>
              {l}+
            </option>
          ))}
        </select>
        <select
          className="sb-control"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="">all</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      {events.length === 0 ? (
        <div className="section-note">no events yet</div>
      ) : (
        events.map((e) => (
          <div
            key={e.seq}
            className={`events-row events-row--${e.level}`}
            title={`${e.op} ${JSON.stringify(e.detail ?? {})}`}
          >
            <span className={`events-level events-level--${e.level}`}>
              {e.level}
            </span>
            <span className="events-op">{e.op}</span>
            {e.outcome && <span className="events-outcome">{e.outcome}</span>}
            <span className="events-time">{shortTime(e.ts)}</span>
          </div>
        ))
      )}
    </div>
  );
}
