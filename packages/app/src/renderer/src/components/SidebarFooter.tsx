import { useState } from "react";
import { AccountsPopover } from "./AccountsPopover";
import { SettingsMenu } from "./SettingsMenu";

export function SidebarFooter() {
  const [open, setOpen] = useState<"accounts" | "settings" | null>(null);
  return (
    <div className="sidebar-footer">
      {/* Click-away backdrop: a transparent full-screen layer behind whichever
          popover is open. Clicking anywhere outside the popover closes it. It
          sits below the popover (z-index) but above the rest of the app. */}
      {open !== null && (
        <button
          type="button"
          className="popover-backdrop"
          aria-label="Close menu"
          onClick={() => setOpen(null)}
        />
      )}
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
      {open === "settings" && <SettingsMenu onClose={() => setOpen(null)} />}
    </div>
  );
}
