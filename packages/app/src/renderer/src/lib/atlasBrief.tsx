// The composer writes light markdown (** for emphasis, "- " and "1." lists).
// Rendering it raw shows literal asterisks. This handles just those shapes --
// a full markdown engine would be far more than this needs. Extracted so the
// popover and the sidebar section share one renderer instead of drifting.

function inline(text: string, key: string) {
  // Keyed by the part's OFFSET in the source string, not by array index: the
  // offset is a real identity for that run of text.
  let at = 0;
  return text.split(/(\*\*[^*]+\*\*)/g).map((part) => {
    const k = `${key}@${at}`;
    at += part.length;
    return part.startsWith("**") && part.endsWith("**") ? (
      <strong key={k}>{part.slice(2, -2)}</strong>
    ) : (
      <span key={k}>{part}</span>
    );
  });
}

export function renderBrief(text: string) {
  return text.split("\n").map((line, i) => {
    const k = `l${i}`;
    const t = line.trim();
    if (t.length === 0) return <div key={k} className="atlas-brief-gap" />;
    const bullet = /^[-*]\s+/.test(t);
    return (
      <p key={k} className={bullet ? "atlas-brief-item" : "atlas-brief-line"}>
        {inline(bullet ? t.replace(/^[-*]\s+/, "") : t, k)}
      </p>
    );
  });
}
