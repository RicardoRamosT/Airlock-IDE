import { useCallback, useEffect, useState } from "react";
import type {
  AgentCommandPolicy,
  RiskAction,
  RiskCategory,
} from "../../../shared/ipc";

const ROWS: { key: RiskCategory; label: string }[] = [
  { key: "network", label: "Reach the network" },
  { key: "outsideWorkspace", label: "Touch files outside the project" },
  { key: "destructive", label: "Destructive (rm -rf, force push, ...)" },
  { key: "privilege", label: "Elevated privileges (sudo)" },
];
const ACTIONS: RiskAction[] = ["allow", "ask", "block"];

export function AgentSection() {
  const [policy, setPolicy] = useState<AgentCommandPolicy | null>(null);

  const refresh = useCallback(async () => {
    setPolicy(await window.airlock.getAgentPolicy());
  }, []);

  useEffect(() => {
    refresh().catch(console.error);
  }, [refresh]);

  if (!policy) return <div className="settings-note">loading...</div>;

  const set = (key: RiskCategory, action: RiskAction) => {
    const next = { ...policy, [key]: action };
    setPolicy(next);
    void window.airlock.setAgentPolicy(next).catch(console.error);
  };

  return (
    <div className="agent-policy">
      <div className="settings-note">
        How the agent's commands are gated. "Ask" lets the agent proceed only
        after it confirms with you; "Block" is absolute.
      </div>
      {ROWS.map((row) => (
        <div key={row.key} className="agent-policy-row">
          <span className="agent-policy-label">{row.label}</span>
          <div className="seg">
            {ACTIONS.map((a) => (
              <button
                key={a}
                type="button"
                className={
                  policy[row.key] === a ? `seg-btn seg-on seg-${a}` : "seg-btn"
                }
                aria-pressed={policy[row.key] === a}
                aria-label={`${row.label}: ${a}`}
                onClick={() => set(row.key, a)}
              >
                {a}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
