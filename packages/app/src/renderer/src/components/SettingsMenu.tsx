import { useState } from "react";
import { useApp } from "../store";

// Gear popover, modeled on VS Code's manage menu. Only the items that map to a
// real airlock feature are present: Settings (opens the tab) and a Themes
// submenu (live Dark/Light switch, persisted app-global). Command Palette /
// Keyboard Shortcuts intentionally omitted.
export function SettingsMenu({ onClose }: { onClose: () => void }) {
  const setSettingsOpen = useApp((s) => s.setSettingsOpen);
  const theme = useApp((s) => s.theme);
  const setTheme = useApp((s) => s.setTheme);
  const [themesOpen, setThemesOpen] = useState(false);

  const chooseTheme = (t: "dark" | "light") => {
    // Mark hydrated so a still-in-flight startup prefsGet cannot clobber this
    // user choice (same race the layout buttons guard against).
    useApp.getState().setLayoutHydrated(true);
    setTheme(t);
    document.documentElement.setAttribute("data-theme", t);
    void window.airlock.prefsSet({ theme: t });
    onClose();
  };

  return (
    <div className="popover settings-menu">
      <button
        type="button"
        className="menu-item"
        onClick={() => {
          setSettingsOpen(true);
          onClose();
        }}
      >
        <span>Settings</span>
        <span className="menu-shortcut">{"⌘,"}</span>
      </button>
      <button
        type="button"
        className="menu-item"
        onClick={() => setThemesOpen(!themesOpen)}
      >
        <span>Themes</span>
        <span className="menu-shortcut">{"›"}</span>
      </button>
      {themesOpen && (
        <div className="submenu">
          <button
            type="button"
            className="menu-item"
            onClick={() => chooseTheme("dark")}
          >
            <span>Dark{theme === "dark" ? " ✓" : ""}</span>
          </button>
          <button
            type="button"
            className="menu-item"
            onClick={() => chooseTheme("light")}
          >
            <span>Light{theme === "light" ? " ✓" : ""}</span>
          </button>
        </div>
      )}
    </div>
  );
}
