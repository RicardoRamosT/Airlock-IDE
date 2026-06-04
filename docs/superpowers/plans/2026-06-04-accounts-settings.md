# Airlock Accounts + Settings + Themes Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** A VS-Code-style sidebar footer with two icons — **accounts** (person) and **settings** (gear). Accounts shows every `gh`-logged-in GitHub account with a status dot on the active one, click to switch, and a warning when the repo's commit identity differs from the active account. Settings opens as a tab in the main area with airlock's real options. Themes adds a full **light** palette switchable from the gear menu, persisted app-globally.

**Owner decisions (2026-06-04):** accounts = `gh`-based, switch + identity-warning. Gear menu = Settings + Themes (Command Palette / Keyboard Shortcuts skipped; **auto-update deferred** — needs code signing + a release host airlock doesn't have). Light theme + Themes submenu in scope.

**Verified on the owner's machine:** `gh` 2.87.3; two accounts (`RicardoRamosT` active, `vnricardotrevino` inactive); `gh auth status` emits a parseable per-account format with `Active account: true/false`; `gh auth switch` is non-interactive with `--user`; `gh` redacts the token (`gho_****`) so airlock never sees credentials. The active gh account (`RicardoRamosT`) differs from this repo's commit identity (`vnricardotrevino`) — the warning the panel surfaces.

**Context:** branched off `feat/layout-controls` (which stacks on `feat/hardening`) — all still awaiting one gate. ASCII-only comments in agent-core. The gh module is electron-free (execFile, like git/run.ts) and lives in `agent-core/github/`.

---

### Task 1: gh accounts module (TDD) + git identity + IPC

**Files:**
- Create: `packages/agent-core/src/github/accounts.ts`
- Create: `packages/agent-core/src/github/accounts.test.ts`
- Modify: `packages/agent-core/src/index.ts`
- Modify: `packages/app/src/shared/ipc.ts`
- Modify: `packages/app/src/main/ipc.ts`
- Modify: `packages/app/src/preload/index.ts`

- [ ] **Step 1: accounts.ts** — pure parser + execFile shell-outs (mirror git/run.ts). ASCII comments.

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

export interface GhAccount {
  host: string;
  username: string;
  active: boolean;
}

/**
 * Parse `gh auth status` output. Format (gh 2.x), per host then per account:
 *   github.com
 *     <glyph> Logged in to github.com account NAME (keyring)
 *     - Active account: true|false
 *     ...
 * Glyph-independent: we key off "Logged in to <host> account <name>" and
 * "Active account: true". Multiple hosts and multiple accounts supported.
 */
export function parseGhAuthStatus(raw: string): GhAccount[] {
  const accounts: GhAccount[] = [];
  const lines = raw.split(/\r?\n/);
  let pending: { host: string; username: string } | null = null;
  const flush = (active: boolean) => {
    if (pending) {
      accounts.push({ host: pending.host, username: pending.username, active });
      pending = null;
    }
  };
  for (const line of lines) {
    const m = line.match(/Logged in to (\S+) account (\S+)/);
    if (m?.[1] && m[2]) {
      // A new account block begins; if a previous one had no explicit Active
      // line (older gh), default it to false before starting the next.
      flush(false);
      pending = { host: m[1], username: m[2] };
      continue;
    }
    const a = line.match(/Active account:\s*(true|false)/i);
    if (a && pending) {
      flush(a[1]?.toLowerCase() === "true");
    }
  }
  flush(false);
  return accounts;
}

export interface GhRunner {
  (args: string[]): Promise<string>;
}

const realGh: GhRunner = async (args) => {
  const { stdout } = await exec("gh", args, { maxBuffer: 4 * 1024 * 1024 });
  return stdout;
};

export interface GhStatus {
  installed: boolean;
  accounts: GhAccount[];
}

/** List logged-in GitHub accounts. installed:false if gh is absent. */
export async function ghAccounts(run: GhRunner = realGh): Promise<GhStatus> {
  try {
    // gh writes auth status to stderr in some versions; capture both via the
    // runner. The real runner reads stdout; for status, gh 2.4+ uses stdout.
    const out = await run(["auth", "status"]);
    return { installed: true, accounts: parseGhAuthStatus(out) };
  } catch (err) {
    const e = err as { code?: string; stderr?: string; stdout?: string };
    if (e.code === "ENOENT") return { installed: false, accounts: [] };
    // gh present but not logged in (nonzero exit): parse whatever it emitted.
    const text = `${e.stdout ?? ""}\n${e.stderr ?? ""}`;
    return { installed: true, accounts: parseGhAuthStatus(text) };
  }
}

/** Switch the active account for a host (non-interactive). */
export async function switchGhAccount(
  host: string,
  username: string,
  run: GhRunner = realGh,
): Promise<void> {
  if (!/^[A-Za-z0-9.-]+$/.test(host) || !/^[A-Za-z0-9-]+$/.test(username)) {
    throw new Error("Invalid host or username");
  }
  await run(["auth", "switch", "--hostname", host, "--user", username]);
}
```

NOTE (verify during impl): some `gh` versions print `auth status` to **stderr**, not stdout. If the real runner's stdout is empty but exit is 0, also read stderr. Adjust `realGh`/`ghAccounts` so status text is captured regardless of stream — test the actual behavior of gh 2.87.3 (run `gh auth status` and check which stream) and make the runner robust. Document what you found.

- [ ] **Step 2: accounts.test.ts** — TDD the PURE parser against the captured real format (no gh needed):

```ts
import { describe, expect, it } from "vitest";
import { parseGhAuthStatus, switchGhAccount } from "./accounts";

const REAL = `github.com
  ✓ Logged in to github.com account RicardoRamosT (keyring)
  - Active account: true
  - Git operations protocol: https
  - Token: gho_************************************
  - Token scopes: 'gist', 'read:org', 'repo', 'workflow'

  ✓ Logged in to github.com account vnricardotrevino (keyring)
  - Active account: false
  - Git operations protocol: https
  - Token: gho_************************************
  - Token scopes: 'gist', 'read:org', 'repo', 'workflow'
`;

describe("parseGhAuthStatus", () => {
  it("parses multiple accounts with the active marker", () => {
    expect(parseGhAuthStatus(REAL)).toEqual([
      { host: "github.com", username: "RicardoRamosT", active: true },
      { host: "github.com", username: "vnricardotrevino", active: false },
    ]);
  });

  it("returns [] for empty / not-logged-in output", () => {
    expect(parseGhAuthStatus("")).toEqual([]);
    expect(parseGhAuthStatus("You are not logged into any GitHub hosts.")).toEqual([]);
  });

  it("handles a single account", () => {
    const one = "github.com\n  Logged in to github.com account solo (oauth_token)\n  - Active account: true\n";
    expect(parseGhAuthStatus(one)).toEqual([{ host: "github.com", username: "solo", active: true }]);
  });

  it("handles an enterprise host alongside github.com", () => {
    const multi = `github.com
  Logged in to github.com account alice (keyring)
  - Active account: true
ghe.corp.com
  Logged in to ghe.corp.com account alice-corp (keyring)
  - Active account: true
`;
    expect(parseGhAuthStatus(multi)).toEqual([
      { host: "github.com", username: "alice", active: true },
      { host: "ghe.corp.com", username: "alice-corp", active: true },
    ]);
  });
});

describe("switchGhAccount", () => {
  it("rejects injected host/username and runs the right argv otherwise", async () => {
    await expect(switchGhAccount("github.com", "bad;rm", async () => "")).rejects.toThrow(/invalid/i);
    let captured: string[] = [];
    await switchGhAccount("github.com", "alice", async (args) => {
      captured = args;
      return "";
    });
    expect(captured).toEqual(["auth", "switch", "--hostname", "github.com", "--user", "alice"]);
  });
});
```

(TDD: witness fail, implement, all pass.)

- [ ] **Step 3: index.ts** — export `ghAccounts`, `switchGhAccount`, `parseGhAuthStatus`, types `GhAccount`, `GhStatus`.

- [ ] **Step 4: shared/ipc.ts** — re-export `GhAccount`, `GhStatus`; add a `GithubInfo` type combining accounts + repo identity, and AirlockApi methods:

```ts
export interface GitIdentity { name: string | null; email: string | null }
export interface GithubInfo { gh: GhStatus; identity: GitIdentity }
// AirlockApi:
  githubInfo(): Promise<GithubInfo>;
  githubSwitch(host: string, username: string): Promise<void>;
```

- [ ] **Step 5: main/ipc.ts** — import ghAccounts/switchGhAccount; read git identity via the existing git runner (or `runGit(root, ["config", "user.name"])` / `user.email`, tolerant of no-repo → null). Handlers:

```ts
  ipcMain.handle("github:info", async () => {
    const gh = await ghAccounts();
    let name: string | null = null;
    let email: string | null = null;
    if (workspaceRoot) {
      try { name = (await runGit(workspaceRoot, ["config", "user.name"])).trim() || null; } catch {}
      try { email = (await runGit(workspaceRoot, ["config", "user.email"])).trim() || null; } catch {}
    }
    return { gh, identity: { name, email } };
  });
  ipcMain.handle("github:switch", (_e, host: unknown, username: unknown) => {
    if (typeof host !== "string" || typeof username !== "string") throw new Error("Invalid payload");
    return switchGhAccount(host, username);
  });
```

(import runGit from @airlock/agent-core.) NOT requireRoot-gated — accounts work with no folder open (identity is just null then).

- [ ] **Step 6: preload** — `githubInfo: () => ipcRenderer.invoke("github:info")`, `githubSwitch: (h, u) => ipcRenderer.invoke("github:switch", h, u)`.

- [ ] **Step 7: verify** — `npm test` (112 + parser/switch tests), typecheck, lint, `npm run build`. Commit: `feat(agent-core): gh account listing + switch + git identity, exposed over IPC`

---

### Task 2: Light theme + theme engine (prefs-persisted)

**Files:**
- Modify: `packages/app/src/main/prefs.ts` + `prefs.test.ts` (add `theme`)
- Modify: `packages/app/src/shared/ipc.ts` (AppPrefs.theme)
- Modify: `packages/app/src/renderer/src/store.ts` (theme state)
- Modify: `packages/app/src/renderer/src/lib/usePrefs.ts` (hydrate theme + apply data-theme)
- Modify: `packages/app/src/renderer/src/components/TerminalPane.tsx` (theme-aware xterm)
- Modify: `packages/app/src/renderer/src/components/Viewer.tsx` (theme-aware CM6)
- Modify: `packages/app/src/renderer/src/theme.css` (light palette under [data-theme="light"])

- [ ] **Step 1: prefs.ts** — `AppPrefs` gains `theme: "dark" | "light"` (default "dark"); sanitize: `theme === "light" ? "light" : "dark"`; DEFAULTS add `theme: "dark"`. Add a test asserting theme round-trips + sanitizes garbage to "dark". (AppPrefs lives in shared/ipc.ts — add the field there; prefs.ts sanitize handles it.)

- [ ] **Step 2: theme.css** — the existing `:root { --bg: #0d1117; ... }` is the dark palette. Add a light override keyed on a `data-theme` attribute on `<html>`:

```css
:root[data-theme="light"] {
  --bg: #ffffff;
  --bg-panel: #f6f8fa;
  --border: #d0d7de;
  --fg: #1f2328;
  --fg-dim: #656d76;
  --accent: #0969da;
  --hover: rgba(31, 35, 40, 0.06);
  --selected: rgba(9, 105, 218, 0.12);
}
```

(GitHub light palette. Everything using var(--*) re-themes for free. Keep the existing dark values as the default `:root`.) Also audit any hardcoded dark hexes in theme.css (e.g. `.tree-item:hover { background:#1a2129 }`, badge colors `#2d1f12`/`#d29922`, secret-delete hover `#f85149`, `.btn` `#1a2129`/`#222b36`) — replace the structural ones with vars (`--hover`, etc.) so they invert; semantic colors (error red, amber) can stay but pick values that read on both — use `--hover`/`--selected`/`--border` wherever it's a neutral surface. Report which hardcoded values you converted.

- [ ] **Step 3: store.ts** — add `theme: "dark" | "light"` (default "dark") + `setTheme(t)`. Do NOT reset in setRoot (app-global).

- [ ] **Step 4: usePrefs.ts** — on hydrate, also `setTheme(p.theme)` AND apply it to the DOM: `document.documentElement.setAttribute("data-theme", p.theme)`. Provide a small effect or have setTheme callers also set the attribute. Cleanest: a `useEffect` in App (or a `useTheme` hook) that watches store.theme and sets `document.documentElement.dataset.theme = theme` whenever it changes (covers both hydrate and live toggle). Add that hook/effect; ensure the guard against the layoutHydrated race is respected (theme hydrate should also bail if user changed it first — extend the layoutHydrated guard to cover theme, or add a parallel flag; simplest: the existing layoutHydrated guard already gates the whole prefs hydrate, so theme rides along — confirm theme is set inside the same guarded .then).

- [ ] **Step 5: TerminalPane.tsx** — xterm's `theme` option is a hardcoded dark hex object. Make it theme-aware: read `useApp((s) => s.theme)`; build the xterm theme object from the current theme (dark = current values; light = GitHub-light terminal colors: background #ffffff, foreground #1f2328, cursor #0969da, selectionBackground rgba light). When theme changes, update the live terminal: `term.options.theme = <newThemeObj>` in an effect on `theme` (xterm supports updating options.theme live). Keep the existing PTY lifecycle intact — only the theme object becomes reactive. (Do NOT remount the terminal on theme change — just set term.options.theme.)

- [ ] **Step 6: Viewer.tsx** — CM6 uses `oneDark`. Make theme-aware: when light, omit oneDark (CM6's default light) or use a light theme extension. Since the EditorView is recreated per [selectedFile, file, diff] anyway, also add `theme` to the effect deps so switching theme rebuilds the viewer with the right CM theme. For light: drop `oneDark` from the extensions (CM6 default is light-ish) OR add `@codemirror/theme` light — simplest: conditionally include `oneDark` only when theme==="dark"; light uses CM6 defaults which read on a white bg. Confirm the diff merge-view tints (--cm-deletedChunk etc.) still read on light (they use rgba over the bg — fine).

- [ ] **Step 7: verify** — typecheck, tests (prefs theme test added), lint, build. To verify theme switching without UI yet: the store defaults dark; you can't toggle headlessly, but confirm the CSS light block exists, data-theme wiring compiles, xterm/CM6 read store.theme. Commit: `feat(app): light theme + theme engine (data-theme, xterm/CM6 aware, prefs-persisted)`

---

### Task 3: Sidebar footer + GitHub accounts popover

**Files:**
- Create: `packages/app/src/renderer/src/components/SidebarFooter.tsx`
- Create: `packages/app/src/renderer/src/components/AccountsPopover.tsx`
- Modify: `packages/app/src/renderer/src/components/Sidebar.tsx` (render footer at bottom)
- Modify: `packages/app/src/renderer/src/theme.css`

- [ ] **Step 1: SidebarFooter.tsx** — a footer pinned to the sidebar bottom with two icon buttons: person (`codicon-account`) and gear (`codicon-gear`). Each toggles a popover (accounts / settings-menu). Track which popover is open in local state; clicking outside closes (a backdrop or click-away). The gear menu is Task 4; for THIS task render the person→AccountsPopover; leave a placeholder onClick for the gear (Task 4 fills it).

```tsx
import { useState } from "react";
import { AccountsPopover } from "./AccountsPopover";

export function SidebarFooter() {
  const [open, setOpen] = useState<"accounts" | "settings" | null>(null);
  return (
    <div className="sidebar-footer">
      <button type="button" className={`footer-btn${open === "accounts" ? " active" : ""}`} title="Accounts" onClick={() => setOpen(open === "accounts" ? null : "accounts")}>
        <i className="codicon codicon-account" />
      </button>
      <button type="button" className={`footer-btn${open === "settings" ? " active" : ""}`} title="Settings" onClick={() => setOpen(open === "settings" ? null : "settings")}>
        <i className="codicon codicon-gear" />
      </button>
      {open === "accounts" && <AccountsPopover onClose={() => setOpen(null)} />}
      {/* open === "settings" -> SettingsMenu, wired in Task 4 */}
    </div>
  );
}
```

(CODICON VERIFY: `account`, `gear` — grep; substitute `person`/`settings-gear` if needed, report.)

- [ ] **Step 2: AccountsPopover.tsx** — fetch `githubInfo()` on mount; render accounts with a status dot (filled `--accent`/green for active, hollow for others); click an inactive one → `githubSwitch(host, username)` → refetch; show the commit-identity line + a warning when the active gh username !== git identity name. gh-absent / no-accounts empty states.

```tsx
import { useCallback, useEffect, useState } from "react";
import type { GithubInfo } from "../../shared/ipc";

export function AccountsPopover({ onClose }: { onClose: () => void }) {
  const [info, setInfo] = useState<GithubInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(() => {
    window.airlock.githubInfo().then(setInfo).catch(console.error);
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const active = info?.gh.accounts.find((a) => a.active) ?? null;
  const mismatch =
    !!active && !!info?.identity.name && active.username.toLowerCase() !== info.identity.name.toLowerCase();

  const switchTo = async (host: string, username: string) => {
    setBusy(true);
    try { await window.airlock.githubSwitch(host, username); refresh(); }
    catch (e) { console.error(e); }
    finally { setBusy(false); }
  };

  return (
    <div className="popover accounts-popover">
      <div className="popover-title">GitHub accounts</div>
      {!info && <div className="popover-note">loading...</div>}
      {info && !info.gh.installed && (
        <div className="popover-note">GitHub CLI (gh) not found. Install it to manage accounts.</div>
      )}
      {info && info.gh.installed && info.gh.accounts.length === 0 && (
        <div className="popover-note">No accounts. Run `gh auth login` in the terminal.</div>
      )}
      {info?.gh.accounts.map((a) => (
        <button
          key={`${a.host}:${a.username}`}
          type="button"
          className={`account-row${a.active ? " active" : ""}`}
          disabled={busy || a.active}
          title={a.active ? "Active account" : `Switch to ${a.username}`}
          onClick={() => switchTo(a.host, a.username)}
        >
          <span className={`status-dot${a.active ? " on" : ""}`} />
          <span className="account-name">{a.username}</span>
          <span className="account-host">{a.host}</span>
        </button>
      ))}
      {info && info.identity.name && (
        <div className="identity-line">
          commits as <strong>{info.identity.name}</strong>
          {info.identity.email ? ` <${info.identity.email}>` : ""}
        </div>
      )}
      {mismatch && (
        <div className="identity-warning">
          <i className="codicon codicon-warning" /> active GitHub account ({active?.username}) does not match this repo's commit name
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Sidebar.tsx** — make the sidebar a column with the sections scrollable and `<SidebarFooter />` pinned at the bottom (flex column; sections area `flex:1; overflow-y:auto`; footer `flex:none`).

- [ ] **Step 4: theme.css** — `.sidebar-footer` (flex row, border-top, padding, gap); `.footer-btn` (icon button, hover/active via --hover); `.popover` (absolute, positioned above the footer, `--bg-panel` bg, border, shadow, rounded, z-index); `.account-row` (flex, hover); `.status-dot` (10px circle, `.on` = filled `--accent` or a green, off = hollow border); `.account-host` (dim, small); `.identity-line` (dim); `.identity-warning` (amber). All using vars so they theme.

- [ ] **Step 5: verify** — typecheck, tests, lint, build. (Popover interaction is gate-verified.) Commit: `feat(app): sidebar footer + GitHub accounts popover (gh accounts, active dot, switch, identity warning)`

---

### Task 4: Gear menu + Settings tab + Themes submenu

**Files:**
- Create: `packages/app/src/renderer/src/components/SettingsMenu.tsx`
- Create: `packages/app/src/renderer/src/components/SettingsTab.tsx`
- Modify: `packages/app/src/renderer/src/components/SidebarFooter.tsx` (wire gear → SettingsMenu)
- Modify: `packages/app/src/renderer/src/store.ts` (settingsOpen flag)
- Modify: `packages/app/src/renderer/src/App.tsx` (viewer-pane shows SettingsTab when settingsOpen)
- Modify: `packages/app/src/renderer/src/components/Viewer.tsx` OR App (settings precedence in the split)
- Modify: `packages/app/src/renderer/src/theme.css`

- [ ] **Step 1: store.ts** — add `settingsOpen: boolean` + `setSettingsOpen(v)`. Opening settings clears file/diff (mutually exclusive viewer content): `setSettingsOpen: (v) => set({ settingsOpen: v, ...(v ? { selectedFile: null, file: null, diff: null } : {}) })`. setSelected/setDiff also clear settingsOpen.

- [ ] **Step 2: SettingsMenu.tsx** — the gear popover, VS-Code-styled (rows with right-aligned shortcut hints, separators, a Themes submenu). Items: **Settings** (⌘,) → `setSettingsOpen(true)` + onClose; **Themes ›** → inline submenu with Dark / Light (check the active one) → setTheme + prefsSet({theme}) + set data-theme. Render like the VS Code menu (the screenshot): each row `.menu-item` with label + `.menu-shortcut`.

```tsx
import { useState } from "react";
import { useApp } from "../store";

export function SettingsMenu({ onClose }: { onClose: () => void }) {
  const setSettingsOpen = useApp((s) => s.setSettingsOpen);
  const theme = useApp((s) => s.theme);
  const setTheme = useApp((s) => s.setTheme);
  const [themesOpen, setThemesOpen] = useState(false);

  const chooseTheme = (t: "dark" | "light") => {
    setTheme(t);
    document.documentElement.setAttribute("data-theme", t);
    void window.airlock.prefsSet({ theme: t });
    onClose();
  };

  return (
    <div className="popover settings-menu">
      <button type="button" className="menu-item" onClick={() => { setSettingsOpen(true); onClose(); }}>
        <span>Settings</span><span className="menu-shortcut">{"⌘,"}</span>
      </button>
      <button type="button" className="menu-item" onClick={() => setThemesOpen(!themesOpen)}>
        <span>Themes</span><span className="menu-shortcut">{"›"}</span>
      </button>
      {themesOpen && (
        <div className="submenu">
          <button type="button" className="menu-item" onClick={() => chooseTheme("dark")}>
            <span>Dark{theme === "dark" ? " ✓" : ""}</span>
          </button>
          <button type="button" className="menu-item" onClick={() => chooseTheme("light")}>
            <span>Light{theme === "light" ? " ✓" : ""}</span>
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: SettingsTab.tsx** — the main-area settings view. Sections (airlock's real, EXISTING settings — surfaced in one place; with a ✕ to close):
  - **Appearance**: Theme radio (Dark/Light) — setTheme + prefsSet + data-theme.
  - **Layout**: Sidebar position (Left/Right) — toggleSidebarPosition + prefsSet (reuse the store actions).
  - **Secrets** (only when a folder is open): "Inject secrets into terminal" checkbox — reads config, configSet (reuse the existing config IPC). Show "open a folder" note if no root.
  - Header "Settings" + close ✕ → setSettingsOpen(false).
  Keep it honest and lean; a note at the bottom: "More settings arrive with the agent (model, redaction)."

- [ ] **Step 4: SidebarFooter.tsx** — wire `open === "settings" && <SettingsMenu onClose={() => setOpen(null)} />`.

- [ ] **Step 5: App.tsx** — the viewer-pane renders `<SettingsTab />` when settingsOpen, else `<Viewer />`; the split opens when `selectedFile || diff || settingsOpen`. (Settings takes over the viewer-pane slot like a document.)

```tsx
  const settingsOpen = useApp((s) => s.settingsOpen);
  ...
  <div className={`main${selectedFile || diff || settingsOpen ? " split" : ""}`}>
    <div className="viewer-pane">{settingsOpen ? <SettingsTab /> : <Viewer />}</div>
    ...
```

- [ ] **Step 6: theme.css** — `.menu-item` (full-width, flex space-between, hover --hover, padding), `.menu-shortcut` (dim, mono), `.submenu` (indented), `.settings-menu`/`.settings-tab` layout (the tab: padded sections, headings, radio/checkbox rows). VS-Code-ish spacing. All via vars (themes).

- [ ] **Step 7: verify** — typecheck, tests, lint, build. Commit: `feat(app): gear menu + Settings tab + Themes submenu (dark/light)`

---

### Task 5: docs + verify + repackage + gate

- [ ] Spec §9 blockquote: sidebar footer (accounts + gear), gh-based account panel (active dot, switch, identity warning; gh redacts tokens so airlock never sees credentials), Settings tab, light theme + Themes (app-global, persisted), auto-update explicitly DEFERRED (needs signing + release host).
- [ ] README: a "GitHub accounts" + "Settings & Themes" note; mention light theme.
- [ ] Full verify: `npm test`, typecheck, lint, `npm run build`, `npm run package` (do NOT launch). Confirm .app fresh.
- [ ] Commit (NO tag): `docs: accounts/settings/themes complete; repackaged`.
- [ ] **HUMAN GATE** (covers the whole stacked chain — hardening, layout, maximize-removal, this): footer person icon → accounts popover lists RicardoRamosT (dot) + vnricardotrevino; click vnricardotrevino → becomes active (dot moves); identity warning reflects the repo; gear → Settings opens a tab; Themes → Light flips the whole UI (sidebar, terminal, editor) to a light palette and persists across relaunch; gear → Settings tab toggles work. Verdict → tag, merge the chain in order.

---

## Self-review
1. Owner decisions honored: gh-based accounts (switch + identity warning), Settings tab, light theme + Themes; auto-update deferred; Command Palette + Keyboard Shortcuts omitted.
2. gh module is electron-free (execFile), in agent-core/github/, TDD on the pure parser against the real captured format; token never seen (gh redacts); switch input-validated against injection.
3. Theme engine: CSS-var-driven (most UI re-themes free); only xterm + CM6 need explicit theme-awareness; persisted in AppPrefs.theme; hydrate rides the existing layoutHydrated guard.
4. Settings opens in the viewer-pane slot (reuses the split), mutually exclusive with file/diff.
5. Gear menu modeled on VS Code's, containing ONLY items that map (Settings, Themes) — no faked entries (Profile/Extensions/Snippets/Tasks/Sync/Update omitted; auto-update deferred).
6. agent-core stays Electron-free; ASCII comments; renderer window.airlock-only.
