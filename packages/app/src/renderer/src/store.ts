import { create } from "zustand";
import type {
  FileContent,
  GitStatus,
  ProjectConfig,
  SecretMeta,
  SectionVisibility,
} from "../../shared/ipc";

export interface TerminalEntry {
  id: string; // renderer-side uid (not the pty id)
  title: string;
  renamed: boolean; // user renamed -> OSC title updates stop applying
  ptyId: string | null;
}

export type DbView =
  | { kind: "secret"; id: string; schema: string; table: string }
  | {
      kind: "neon";
      projectId: string;
      branchId: string;
      database: string;
      role: string;
      schema: string;
      table: string;
    };

let termCounter = 0;
const newEntry = (): TerminalEntry => ({
  id: `term-${++termCounter}`,
  title: "zsh",
  renamed: false,
  ptyId: null,
});

// Per-tab terminal state. Lives OUTSIDE the top-level per-project fields so that
// every tab's terminals can be rendered (mounted) simultaneously -- only the
// active tab is shown, the rest are hidden via CSS. A pty is killed only when
// its TerminalPane unmounts, so keeping background tabs mounted keeps their
// shells alive across tab switches.
export interface TabTerminals {
  terminals: TerminalEntry[];
  activeTerminalId: string | null;
  splitTerminalId: string | null; // second visible pane; null = no split
}

const emptyTabTerminals = (): TabTerminals => ({
  terminals: [],
  activeTerminalId: null,
  splitTerminalId: null,
});

// A single stable empty TabTerminals for selector fallbacks when a tab id is
// absent (e.g. a ProjectTerminals reading a tab that was just closed). Sharing
// one reference keeps zustand selectors from churning their identity each call.
// Read-only by convention -- every store setter produces fresh objects, so this
// is never mutated.
export const EMPTY_TAB_TERMINALS: TabTerminals = {
  terminals: [],
  activeTerminalId: null,
  splitTerminalId: null,
};

// The non-terminal per-project state that is saved/restored on tab switch. The
// LIVE copy of this for the ACTIVE tab lives at the top level of the store (so
// Sidebar/Viewer/Git/Secrets/StatusBar/DataGrid keep reading `s.root` etc.
// unchanged); INACTIVE tabs park their copy in `tabSnapshots`.
export interface Snapshot {
  selectedFile: string | null;
  file: FileContent | null;
  secrets: SecretMeta[];
  config: ProjectConfig | null;
  gitStatus: GitStatus | null;
  diff: AppState["diff"];
  dbView: DbView | null;
  settingsOpen: boolean;
}

const freshSnapshot = (): Snapshot => ({
  selectedFile: null,
  file: null,
  secrets: [],
  config: null,
  gitStatus: null,
  diff: null,
  dbView: null,
  settingsOpen: false,
});

let projCounter = 0;
const newTabId = (): string => `proj-${++projCounter}`;

// The window ALWAYS has >= 1 tab: the initial state is a single BLANK tab (root
// null) with a real id, so a blank tab renders today's no-folder UI plus a
// working terminal as a first-class tab in the strip. (The old implicit
// activeTabId-null state and IMPLICIT_TAB_ID are retired.)
const INITIAL_TAB_ID = newTabId();

interface AppState {
  // --- Active-tab live per-project state (top level so existing components
  // that read s.root / s.selectedFile / ... keep working unchanged). ---
  root: string | null;
  selectedFile: string | null;
  file: FileContent | null;
  secrets: SecretMeta[];
  config: ProjectConfig | null;
  gitStatus: GitStatus | null;
  settingsOpen: boolean; // Settings tab shown in viewer-pane (excludes file/diff)
  // A vaulted DB table being browsed in the viewer-pane. Like settingsOpen and
  // file/diff this is part of the viewer-pane discriminator: only one of
  // file/diff/settings/dbView is non-null at a time (mutual exclusion).
  dbView: DbView | null;
  diff: {
    path: string;
    which: "staged" | "unstaged";
    original: string;
    modified: string;
  } | null;

  // --- Tab model ---
  tabs: { id: string; root: string | null }[]; // tab order; root null = a BLANK tab
  activeTabId: string; // non-null: the window always has >= 1 tab
  tabSnapshots: Record<string, Snapshot>; // parked non-terminal state of INACTIVE tabs
  tabTerminals: Record<string, TabTerminals>; // per-tab terminals (active + inactive all mounted)
  sessionWorking: Record<string, boolean>; // ptyId -> claude actively working
  tabGlow: Record<string, boolean>; // tabId -> finished-in-background, awaiting a look
  openProjectsAsTabs: boolean; // app-global (persisted); used by later tasks
  showRunningProcessNotice: boolean; // app-global (persisted); gates the kept-busy-terminal notice

  // --- App-global (shared across tabs) ---
  sidebarVisible: boolean; // app-global (persisted), not per-project
  sidebarPosition: "left" | "right"; // app-global (persisted), not per-project
  theme: "dark" | "light"; // app-global (persisted), drives data-theme on <html>
  clipboardClearSeconds: number; // app-global (persisted), seconds before clipboard auto-clears (0 = never)
  sectionVisibility: SectionVisibility; // app-global (persisted), gates sidebar sections
  layoutHydrated: boolean; // default false
  modal:
    | "add-secret"
    | { update: string }
    | {
        requestSecret: {
          requestId: string;
          name: string;
          providerHint?: string;
        };
      }
    | "connect-neon"
    | "connect-render"
    | null;

  // Set when opening a folder KEPT a busy terminal (a running session was not
  // killed); the T3 notice renders on this terminal. Cleared on dismiss/replace.
  runningNotice: { terminalId: string } | null;
  setRunningNotice: (v: { terminalId: string } | null) => void;

  // --- Tab actions ---
  openProject: (root: string) => void;
  openBlankTab: () => void;
  fillActiveTab: (root: string) => void;
  replaceActiveProject: (root: string) => void;
  switchTab: (id: string) => void;
  closeTab: (id: string) => void;
  applyPtyStatus: (ptyId: string, working: boolean) => void;
  setOpenProjectsAsTabs: (v: boolean) => void;
  setShowRunningProcessNotice: (v: boolean) => void;

  // --- Per-project setters (operate on the active tab's top-level state) ---
  setRoot: (root: string | null) => void; // thin adapter -> openProject/closeTab
  setSelected: (relPath: string | null, file: FileContent | null) => void;
  setDiff: (diff: AppState["diff"]) => void;
  setDbView: (v: DbView | null) => void;
  setSecrets: (secrets: SecretMeta[]) => void;
  setConfig: (config: ProjectConfig | null) => void;
  setGitStatus: (gitStatus: GitStatus | null) => void;
  setModal: (modal: AppState["modal"]) => void;

  // --- Terminal setters ---
  // addTerminal/setActiveTerminal/setSplit act on the ACTIVE tab (user actions
  // in the focused project). setTerminalPty/Title/removeTerminal find the tab
  // that OWNS the terminal id (a background tab's pane can fire these on adopt /
  // OSC title / process exit), so they must NOT assume the active tab.
  addTerminal: () => string; // returns new id, sets active (in the active tab)
  removeTerminal: (id: string) => void;
  setActiveTerminal: (id: string) => void;
  setTerminalPty: (id: string, ptyId: string) => void;
  setTerminalTitle: (id: string, title: string, fromUser: boolean) => void;
  setSplit: (id: string | null) => void;

  // --- App-global setters ---
  setSidebarVisible: (v: boolean) => void;
  toggleSidebar: () => void;
  setSidebarPosition: (p: "left" | "right") => void;
  toggleSidebarPosition: () => void;
  setTheme: (t: "dark" | "light") => void;
  setClipboardClearSeconds: (n: number) => void;
  setSectionVisibility: (v: SectionVisibility) => void;
  setSettingsOpen: (v: boolean) => void;
  setLayoutHydrated: (v: boolean) => void;
}

// Read the active tab's live non-terminal state off the top level into a
// Snapshot (parked when the tab is deactivated).
const snapshotActive = (s: AppState): Snapshot => ({
  selectedFile: s.selectedFile,
  file: s.file,
  secrets: s.secrets,
  config: s.config,
  gitStatus: s.gitStatus,
  diff: s.diff,
  dbView: s.dbView,
  settingsOpen: s.settingsOpen,
});

// Map a Snapshot back into the top-level per-project fields (plus root).
const loadSnapshot = (
  root: string | null,
  snap: Snapshot,
): Pick<AppState, keyof Snapshot | "root"> => ({
  root,
  selectedFile: snap.selectedFile,
  file: snap.file,
  secrets: snap.secrets,
  config: snap.config,
  gitStatus: snap.gitStatus,
  diff: snap.diff,
  dbView: snap.dbView,
  settingsOpen: snap.settingsOpen,
});

// Find the id of the tab whose terminal list contains `terminalId`. Used by the
// ownership-routed setters so a background tab's pane updates the right tab.
const findOwningTabId = (
  tabTerminals: Record<string, TabTerminals>,
  terminalId: string,
): string | null => {
  for (const [tabId, tt] of Object.entries(tabTerminals)) {
    if (tt.terminals.some((t) => t.id === terminalId)) return tabId;
  }
  return null;
};

// The tab that owns a pty id (its terminal list contains a terminal with that
// ptyId). Like findOwningTabId but keyed by ptyId rather than the renderer uid;
// used to route a per-session pty:status push to the tab whose dot it drives.
const findTabByPtyId = (
  tabTerminals: Record<string, TabTerminals>,
  ptyId: string,
): string | null => {
  for (const [tabId, tt] of Object.entries(tabTerminals)) {
    if (tt.terminals.some((t) => t.ptyId === ptyId)) return tabId;
  }
  return null;
};

// Is any terminal in this tab's slice working (per the given sessionWorking
// map)? The tab's dot is yellow iff this is true; the glow transition compares
// this before vs after a status update.
const tabIsWorking = (
  tt: TabTerminals | undefined,
  sessionWorking: Record<string, boolean>,
): boolean =>
  (tt?.terminals ?? []).some(
    (t) => t.ptyId !== null && sessionWorking[t.ptyId] === true,
  );

// Apply removeTerminal's promote-active / collapse-split logic to a single
// tab's terminal state. Extracted so it can run against the OWNING tab (which
// may be a background tab) rather than always the active tab.
const removeFromTab = (tt: TabTerminals, id: string): TabTerminals => {
  const terminals = tt.terminals.filter((t) => t.id !== id);
  let splitTerminalId = tt.splitTerminalId === id ? null : tt.splitTerminalId;
  let activeTerminalId = tt.activeTerminalId;
  if (activeTerminalId === id) {
    activeTerminalId = terminals[terminals.length - 1]?.id ?? null;
  }
  // Closing the active pane while split can promote the split pane to active
  // (it is the last remaining tab). The same terminal must never occupy both
  // slots — that leaves a blank second column — so collapse the split when
  // active and split would coincide.
  if (splitTerminalId !== null && splitTerminalId === activeTerminalId) {
    splitTerminalId = null;
  }
  return { terminals, splitTerminalId, activeTerminalId };
};

export const useApp = create<AppState>((set) => ({
  // active-tab live per-project state
  root: null,
  selectedFile: null,
  file: null,
  secrets: [],
  config: null,
  gitStatus: null,
  settingsOpen: false,
  dbView: null,
  diff: null,

  // tab model — start with ONE blank tab (root null). The window always has
  // >= 1 tab; a blank tab renders the existing no-folder empty state and a
  // working terminal, so a default shell can spawn before any folder is opened.
  tabs: [{ id: INITIAL_TAB_ID, root: null }],
  activeTabId: INITIAL_TAB_ID,
  tabSnapshots: {},
  tabTerminals: { [INITIAL_TAB_ID]: emptyTabTerminals() },
  sessionWorking: {},
  tabGlow: {},
  openProjectsAsTabs: true,
  showRunningProcessNotice: true,

  // app-global
  modal: null,
  sidebarVisible: true,
  sidebarPosition: "left",
  theme: "dark",
  clipboardClearSeconds: 30,
  sectionVisibility: {
    files: true,
    secrets: true,
    git: true,
    activity: true,
    databases: true,
    docker: true,
    host: true,
    audit: true,
  },
  layoutHydrated: false,
  runningNotice: null,

  // --- Tab actions ---
  // Append a PROJECT tab (used when the active tab already has a project, tabs
  // mode). Park the outgoing active tab's live non-terminal state, make the new
  // tab active with fresh empty terminals + a fresh snapshot.
  openProject: (root) =>
    set((s) => {
      const id = newTabId();
      const tabSnapshots = {
        ...s.tabSnapshots,
        [s.activeTabId]: snapshotActive(s),
      };
      return {
        tabs: [...s.tabs, { id, root }],
        activeTabId: id,
        tabSnapshots,
        tabTerminals: { ...s.tabTerminals, [id]: emptyTabTerminals() },
        // fresh top-level per-project state for the new tab
        ...loadSnapshot(root, freshSnapshot()),
        // a freshly opened project starts with no modal carried over
        modal: null,
      };
    }),
  // Append a BLANK tab (no folder) and make it active. The tab-strip `+` calls
  // this -- NO folder picker. Parks the outgoing snapshot, fresh empty terminals.
  openBlankTab: () =>
    set((s) => {
      const id = newTabId();
      const tabSnapshots = {
        ...s.tabSnapshots,
        [s.activeTabId]: snapshotActive(s),
      };
      return {
        tabs: [...s.tabs, { id, root: null }],
        activeTabId: id,
        tabSnapshots,
        tabTerminals: { ...s.tabTerminals, [id]: emptyTabTerminals() },
        ...loadSnapshot(null, freshSnapshot()),
        modal: null,
      };
    }),
  // Attach a folder to the active BLANK tab IN PLACE, KEEPING its terminals (so
  // a live `claude`/server in the blank tab's shell survives the attach). Clears
  // any parked snapshot for the tab. (Idle/busy handling is a later task.)
  fillActiveTab: (root) =>
    set((s) => {
      const id = s.activeTabId;
      const tabSnapshots = { ...s.tabSnapshots };
      delete tabSnapshots[id];
      return {
        tabs: s.tabs.map((t) => (t.id === id ? { id, root } : t)),
        tabSnapshots,
        // tabTerminals[id] is intentionally NOT reset -- the blank tab's
        // terminal(s) survive the attach.
        ...loadSnapshot(root, freshSnapshot()),
        modal: null,
      };
    }),
  // Windows-mode "replace the window's single project in place" (active tab
  // already HAS a project): swap the ACTIVE tab's root rather than appending a
  // tab, and reset that tab's terminals to a fresh empty set so the old
  // project's TerminalPanes unmount and their ptys die (correct for replace).
  replaceActiveProject: (root) =>
    set((s) => {
      const id = s.activeTabId;
      // Drop any parked snapshot for this tab from when it held the OLD
      // project, so a later switch-away/back can never load the old project's
      // file/secrets/git against the new root. (switchTab also overwrites it on
      // park, but clearing here keeps replaceActiveProject correct on its own.)
      const tabSnapshots = { ...s.tabSnapshots };
      delete tabSnapshots[id];
      return {
        tabs: s.tabs.map((t) => (t.id === id ? { id, root } : t)),
        tabTerminals: { ...s.tabTerminals, [id]: emptyTabTerminals() },
        tabSnapshots,
        ...loadSnapshot(root, freshSnapshot()),
        modal: null,
      };
    }),
  switchTab: (id) => {
    set((s) => {
      if (id === s.activeTabId) return {};
      const target = s.tabs.find((t) => t.id === id);
      if (!target) return {}; // unknown id -> no-op
      // Park current active tab's live state, load the target's snapshot.
      const tabSnapshots = {
        ...s.tabSnapshots,
        [s.activeTabId]: snapshotActive(s),
      };
      const snap = tabSnapshots[id] ?? freshSnapshot();
      // Activating a tab dismisses its finished-glow (the user is now looking).
      const tabGlow = { ...s.tabGlow };
      delete tabGlow[id];
      return {
        activeTabId: id,
        tabSnapshots,
        tabGlow,
        ...loadSnapshot(target.root, snap),
      };
    });
    // Re-point main + the agent (MCP) at the now-active tab's project. Without
    // this the main side stays on whatever was last OPENED, so the renderer
    // would show tab A while the agent still resolved git/secrets/terminals
    // against B. Read post-set so we use the committed active root (and skip if
    // the switch was a no-op above). A blank target (root null) CLEARS main.
    // Fire-and-forget: nothing in the UI awaits it.
    const root = useApp.getState().root;
    if (root) void window.airlock.workspaceSetActive(root);
    else void window.airlock.workspaceClose();
  },
  closeTab: (id) => {
    // After the set we re-sync main + the agent (MCP) to the now-active project.
    // promotedRoot != null: a neighbor with a folder was promoted -> point main
    // at it. clearMain: the now-active tab is BLANK (a blank neighbor, or the
    // fresh blank tab created when the LAST tab closed) -> CLEAR main's root
    // (workspace:close); otherwise main + the agent would keep resolving git /
    // secrets / run_command against the just-closed project. A background-tab
    // close leaves both unset (active unchanged -> main already correct).
    let promotedRoot: string | null = null;
    let clearMain = false;
    set((s) => {
      const idx = s.tabs.findIndex((t) => t.id === id);
      if (idx === -1) return {}; // unknown id -> no-op
      const tabs = s.tabs.filter((t) => t.id !== id);
      // Removing the tab's terminal state unmounts its panes -> its ptys die.
      const tabTerminals = { ...s.tabTerminals };
      delete tabTerminals[id];
      const tabSnapshots = { ...s.tabSnapshots };
      delete tabSnapshots[id];
      // Drop the closed tab's glow flag (cosmetic cleanup; no tab references it).
      const tabGlow = { ...s.tabGlow };
      delete tabGlow[id];

      if (id !== s.activeTabId) {
        // Closing a background tab: active stays put, top-level unchanged.
        return { tabs, tabTerminals, tabSnapshots, tabGlow };
      }

      // Closing the active tab: promote a neighbor (prefer the previous tab,
      // else the next).
      const neighbor = tabs[idx - 1] ?? tabs[idx] ?? null;
      if (neighbor) {
        const snap = tabSnapshots[neighbor.id] ?? freshSnapshot();
        promotedRoot = neighbor.root; // may be null (blank neighbor)
        clearMain = neighbor.root === null;
        return {
          tabs,
          tabTerminals,
          tabSnapshots,
          tabGlow,
          activeTabId: neighbor.id,
          ...loadSnapshot(neighbor.root, snap),
        };
      }
      // Closed the LAST tab -> open a fresh BLANK tab so the window keeps >= 1
      // tab (instead of the old activeTabId-null no-project state).
      const blankId = newTabId();
      clearMain = true;
      return {
        tabs: [{ id: blankId, root: null }],
        tabSnapshots: {},
        tabTerminals: { [blankId]: emptyTabTerminals() },
        tabGlow: {},
        activeTabId: blankId,
        ...loadSnapshot(null, freshSnapshot()),
        modal: null,
      };
    });
    // Re-sync main + the agent (MCP): a promoted folder-neighbor becomes the
    // active root; a blank now-active tab (blank neighbor or the fresh blank
    // tab from the last-tab close) CLEARS the root so the agent stops resolving
    // against the closed project; a background-tab close does neither (the
    // active root is unchanged).
    if (promotedRoot) void window.airlock.workspaceSetActive(promotedRoot);
    else if (clearMain) void window.airlock.workspaceClose();
  },
  // A1's per-session pty:status push -> per-tab state. Record the session's
  // working bit, then drive the OWNING tab's glow on a working->done edge:
  // - working (after): clear any finished-glow (it is busy, not waiting).
  // - just finished (before working, after not) in a BACKGROUND tab: glow, so
  //   the user knows to switch back. An active tab never glows (they can see
  //   it) -- that branch is guarded by owningTab !== activeTabId. The dot color
  //   itself is derived in the view from sessionWorking; only the glow is stored.
  applyPtyStatus: (ptyId, working) =>
    set((s) => {
      const owningTab = findTabByPtyId(s.tabTerminals, ptyId);
      const sessionWorking = { ...s.sessionWorking, [ptyId]: working };
      if (owningTab === null) return { sessionWorking };
      const after = tabIsWorking(s.tabTerminals[owningTab], sessionWorking);
      const before = tabIsWorking(s.tabTerminals[owningTab], s.sessionWorking);
      let tabGlow = s.tabGlow;
      if (after) {
        // working -> no finished-glow
        if (s.tabGlow[owningTab]) {
          tabGlow = { ...s.tabGlow };
          delete tabGlow[owningTab];
        }
      } else if (before && owningTab !== s.activeTabId) {
        // just finished in a background tab -> glow
        tabGlow = { ...s.tabGlow, [owningTab]: true };
      }
      return { sessionWorking, tabGlow };
    }),
  setOpenProjectsAsTabs: (openProjectsAsTabs) => set({ openProjectsAsTabs }),
  setShowRunningProcessNotice: (showRunningProcessNotice) =>
    set({ showRunningProcessNotice }),

  // Thin adapter so existing callers (Sidebar / menu open-folder / open-recent)
  // keep working. Routes a string root by the ACTIVE tab; null closes the active
  // tab. Delegates to the tab actions directly (each performs its own set)
  // rather than nesting set() calls.
  setRoot: (root) => {
    const s = useApp.getState();
    if (typeof root === "string") {
      const active = s.tabs.find((t) => t.id === s.activeTabId);
      // Blank active tab -> attach the folder in place (keep its terminals).
      // Otherwise tabs mode -> a new tab; windows mode -> replace in place.
      if (active && active.root === null) s.fillActiveTab(root);
      else if (s.openProjectsAsTabs) s.openProject(root);
      else s.replaceActiveProject(root);
      return;
    }
    // null -> close the active tab (closing the last tab becomes a fresh blank).
    s.closeTab(s.activeTabId);
  },
  setSelected: (selectedFile, file) =>
    set({ selectedFile, file, diff: null, settingsOpen: false, dbView: null }),
  setDiff: (diff) =>
    set({
      diff,
      selectedFile: null,
      file: null,
      settingsOpen: false,
      dbView: null,
    }),
  setSecrets: (secrets) => set({ secrets }),
  setConfig: (config) => set({ config }),
  setGitStatus: (gitStatus) => set({ gitStatus }),
  setModal: (modal) => set({ modal }),
  setRunningNotice: (runningNotice) => set({ runningNotice }),

  // --- Terminal setters ---
  addTerminal: () => {
    const entry = newEntry();
    set((s) => {
      const tabId = s.activeTabId;
      const tt = s.tabTerminals[tabId] ?? emptyTabTerminals();
      return {
        tabTerminals: {
          ...s.tabTerminals,
          [tabId]: {
            ...tt,
            terminals: [...tt.terminals, entry],
            activeTerminalId: entry.id,
          },
        },
      };
    });
    return entry.id;
  },
  removeTerminal: (id) =>
    set((s) => {
      const tabId = findOwningTabId(s.tabTerminals, id);
      if (tabId === null) return {};
      const tt = s.tabTerminals[tabId];
      if (!tt) return {};
      return {
        tabTerminals: { ...s.tabTerminals, [tabId]: removeFromTab(tt, id) },
      };
    }),
  setActiveTerminal: (id) =>
    set((s) => {
      const tabId = s.activeTabId;
      const tt = s.tabTerminals[tabId];
      if (!tt) return {};
      // Clicking the tab that is currently in the split slot swaps the two
      // slots: the split pane becomes active and the previous active pane moves
      // into the split slot. Both stay visible. For any other tab we just
      // promote it to active (leaving the split slot untouched).
      const next =
        id === tt.splitTerminalId
          ? {
              ...tt,
              activeTerminalId: id,
              splitTerminalId: tt.activeTerminalId,
            }
          : { ...tt, activeTerminalId: id };
      return { tabTerminals: { ...s.tabTerminals, [tabId]: next } };
    }),
  setTerminalPty: (id, ptyId) =>
    set((s) => {
      const tabId = findOwningTabId(s.tabTerminals, id);
      if (tabId === null) return {};
      const tt = s.tabTerminals[tabId];
      if (!tt) return {};
      return {
        tabTerminals: {
          ...s.tabTerminals,
          [tabId]: {
            ...tt,
            terminals: tt.terminals.map((t) =>
              t.id === id ? { ...t, ptyId } : t,
            ),
          },
        },
      };
    }),
  setTerminalTitle: (id, title, fromUser) =>
    set((s) => {
      const tabId = findOwningTabId(s.tabTerminals, id);
      if (tabId === null) return {};
      const tt = s.tabTerminals[tabId];
      if (!tt) return {};
      return {
        tabTerminals: {
          ...s.tabTerminals,
          [tabId]: {
            ...tt,
            terminals: tt.terminals.map((t) => {
              if (t.id !== id) return t;
              if (!fromUser && t.renamed) return t;
              return { ...t, title, renamed: fromUser ? true : t.renamed };
            }),
          },
        },
      };
    }),
  setSplit: (id) =>
    set((s) => {
      const tabId = s.activeTabId;
      const tt = s.tabTerminals[tabId];
      if (!tt) return {};
      return {
        tabTerminals: {
          ...s.tabTerminals,
          [tabId]: { ...tt, splitTerminalId: id },
        },
      };
    }),

  // --- App-global setters ---
  setSidebarVisible: (sidebarVisible) => set({ sidebarVisible }),
  toggleSidebar: () => set((s) => ({ sidebarVisible: !s.sidebarVisible })),
  setSidebarPosition: (sidebarPosition) => set({ sidebarPosition }),
  toggleSidebarPosition: () =>
    set((s) => ({
      sidebarPosition: s.sidebarPosition === "left" ? "right" : "left",
    })),
  setTheme: (theme) => set({ theme }),
  setClipboardClearSeconds: (clipboardClearSeconds) =>
    set({ clipboardClearSeconds }),
  setSectionVisibility: (sectionVisibility) => set({ sectionVisibility }),
  // Opening Settings clears the file/diff/dbView so the viewer-pane shows only
  // one thing at a time (mutual exclusion). Closing leaves the rest untouched.
  setSettingsOpen: (v) =>
    set({
      settingsOpen: v,
      ...(v
        ? { selectedFile: null, file: null, diff: null, dbView: null }
        : {}),
    }),
  // Browsing a DB table clears file/diff/settings (mutual exclusion), exactly
  // like setSettingsOpen. Passing null closes the data grid (back to terminal).
  setDbView: (v) =>
    set({
      dbView: v,
      ...(v
        ? { selectedFile: null, file: null, diff: null, settingsOpen: false }
        : {}),
    }),
  setLayoutHydrated: (v) => set({ layoutHydrated: v }),
}));
