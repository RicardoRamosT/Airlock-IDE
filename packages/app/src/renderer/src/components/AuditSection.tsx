import { useEffect, useState } from "react";
import type { AuditEntry } from "../../../shared/ipc";
import { useApp } from "../store";

function shortTime(iso: string): string {
  return iso.slice(11, 19);
}

export function AuditSection() {
  const root = useApp((s) => s.root);
  const secrets = useApp((s) => s.secrets);
  const [entries, setEntries] = useState<AuditEntry[]>([]);

  useEffect(() => {
    // secrets is listed as a dep so the audit list refreshes on every broker
    // op (the store's secrets array changes whenever set/delete runs).
    void secrets;
    if (!root) {
      setEntries([]);
      return;
    }
    window.airlock
      .auditRead(20)
      .then((e) => setEntries(e.reverse()))
      .catch(console.error);
  }, [root, secrets]);

  if (!root) return <div className="section-note">open a folder first</div>;
  if (entries.length === 0)
    return <div className="section-note">no operations yet</div>;

  return (
    <div className="audit">
      {entries.map((e) => (
        <div
          key={e.hash}
          className="audit-row"
          title={JSON.stringify(e.detail)}
        >
          <span className="audit-time">{shortTime(e.ts)}</span>
          <span className="audit-op">{e.op}</span>
        </div>
      ))}
    </div>
  );
}
