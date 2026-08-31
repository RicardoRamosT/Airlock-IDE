// Atlas writes light markdown -- **bold**, `code`, "- " bullets, "1." lists --
// and rendering it raw showed literal asterisks and backticks in the chat.
// This handles exactly those shapes; a full markdown engine would be far more
// than this needs. Shared by the debrief and the conversation so the two
// cannot drift.

import type { ReactNode } from "react";

// Split on bold and code together, so a line can contain both. Keyed by the
// part's OFFSET in the source string, never by array index: the offset is a
// real identity for that run of text.
function inline(text: string, key: string): ReactNode[] {
  let at = 0;
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part) => {
    const k = `${key}@${at}`;
    at += part.length;
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={k}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return <code key={k}>{part.slice(1, -1)}</code>;
    }
    return <span key={k}>{part}</span>;
  });
}

export function renderBrief(text: string): ReactNode[] {
  return text.split("\n").map((line, i) => {
    const k = `l${i}`;
    const t = line.trim();
    if (t.length === 0) return <div key={k} className="atlas-brief-gap" />;

    // An ATX heading. Atlas writes these unprompted -- "## Two loose ends" --
    // and without this they rendered as literal hashes in the chat, which is
    // exactly the raw-markdown leak this module exists to prevent. Any level
    // renders the same: this is a chat bubble, not a document outline.
    const atx = /^#{1,6}\s+(.+?)\s*#*$/.exec(t);
    if (atx) {
      return (
        <p key={k} className="atlas-brief-heading">
          {inline(atx[1] ?? "", k)}
        </p>
      );
    }

    // A heading: a whole line that is nothing but bold.
    const heading = /^\*\*(.+)\*\*$/.exec(t);
    if (heading) {
      return (
        <p key={k} className="atlas-brief-heading">
          {heading[1]}
        </p>
      );
    }

    const bullet = /^[-*]\s+/.test(t);
    const numbered = /^\d+[.)]\s+/.test(t);
    if (bullet || numbered) {
      const body = t.replace(/^[-*]\s+/, "").replace(/^\d+[.)]\s+/, "");
      const marker = numbered ? (/^(\d+)/.exec(t)?.[1] ?? "") : "";
      return (
        <p
          key={k}
          className={numbered ? "atlas-brief-num" : "atlas-brief-item"}
          data-marker={marker}
        >
          {inline(body, k)}
        </p>
      );
    }
    return (
      <p key={k} className="atlas-brief-line">
        {inline(t, k)}
      </p>
    );
  });
}
