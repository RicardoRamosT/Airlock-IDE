import { useState } from "react";
import { AccountsPopover } from "./AccountsPopover";

export function SidebarFooter() {
  const [open, setOpen] = useState<"accounts" | "settings" | null>(null);
  return (
    <div className="sidebar-footer">
      <button
        type="button"
        className={`footer-btn${open === "accounts" ? " active" : ""}`}
        title="Accounts"
        onClick={() => setOpen(open === "accounts" ? null : "accounts")}
      >
        <i className="codicon codicon-account" />
      </button>
      <button
        type="button"
        className={`footer-btn${open === "settings" ? " active" : ""}`}
        title="Settings"
        onClick={() => setOpen(open === "settings" ? null : "settings")}
      >
        <i className="codicon codicon-gear" />
      </button>
      {open === "accounts" && <AccountsPopover onClose={() => setOpen(null)} />}
      {/* settings menu wired in Task 4 */}
    </div>
  );
}
