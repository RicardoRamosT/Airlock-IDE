# Changelog

All notable user-facing changes to AirLock. Dates are when the version was cut.

## 0.3.0

### Added
- **Connect a database with a connection string.** A "+ Add database" button in
  the Databases sidebar opens a modal to paste a `postgresql://…` connection
  string (Neon or any Postgres) and browse its tables. The password stays in the
  main process and never reaches the renderer or the AI model.
- **Database & Neon tables open as tabs.** Browsing a table now opens a
  persistent, switchable, closable tab in the main tab bar instead of a
  full-pane overlay.
- **Remove a database** directly from the Databases section (per-row button).
- **Terminal keyboard text selection** on the current command line:
  `Cmd+Shift+←/→` selects to line start/end, `Option+Shift+←/→` selects/extends
  by word, and `Cmd+C` copies the highlight.
- **CLI integrations.** Manifest-driven status panels for external CLIs —
  **Vercel**, **Snowflake**, and **Azure** (Web Apps) — shown in the
  Databases/Host sidebar with Install/Connect buttons when a CLI is missing or
  unauthenticated, plus integration status in the Activity feed.
- **Choose your terminal.** Pick a default external terminal (iTerm, Ghostty, …)
  in Settings; new terminals open there.
- **Find All References** in the editor — right-click → Find All References, or
  `Shift+F12`, with a results overlay.

### Changed
- **Standardized sidebar layout.** Every section (Files, Git, Secrets,
  Databases, Neon, Integrations, Docker, Host, Render, Activity, Audit) now
  shares one layout grammar: uniform control heights, spacing, equal-width
  toolbar buttons, row actions, inputs, and empty states.
- **Neon Connect panel** gained a **Disconnect** button, and the connect field
  now rejects a Postgres connection string pasted where the API key belongs.
- **HOST view** uses consistent full-width Connect / Set-URL buttons; a
  connected integration with nothing to list now shows "no resources" instead of
  a blank header.

### Fixed
- The Neon panel no longer gets stuck on "401 Unauthorized" with no way to clear
  a bad/stale key.
- HOST dev-server detection: detect by subdirectory + probe, re-probe every 5s
  while focused, and stop reporting macOS AirPlay (port 5000) as a live server.
- Window first paint no longer collapses; the status bar no longer balloons in
  multi-window mode; status-bar divider + terminal overflow clipped at the grid
  seam.
- Usage dashboard: corrected liveness, per-model attribution, and reset-time
  display.

### Internal
- The renderer no longer bundles native modules (agent-core boundary enforced),
  fixing a packaging break.
- Connection-string validator requires real `user:password@host` credentials so
  a credential-less URL can't silently fail to appear.

## 0.2.0

- Prior release (terminal-first IDE shell, projects/tabs/splits, Secrets vault,
  Databases browser, Claude quota meter + usage dashboard, Claude auto-start).
