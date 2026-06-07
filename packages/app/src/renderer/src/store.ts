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

// The full non-terminal per-project state for ONE tab. `tabState` keeps one of
// these for EVERY tab (the source of truth); the top-level per-project fields
// (root/selectedFile/...) are a MIRROR of the ACTIVE tab's ProjectState, so
// Sidebar/Viewer/Git/Secrets/StatusBar/DataGrid keep reading `s.root` etc.
// unchanged (single-pane behavior). The split pane (a later task) reads
// `tabState[tabId]` directly. (Replaces the old Snapshot park/load model.)
// A pane's content reference: a terminal (by id) or an open file (by path). The
// unified main area shows a PRIMARY pane and, when split, a SECONDARY pane; each
// can hold either kind, so any combo splits (term|term, file|file, file|term).
export type PaneItem =
  | { kind: "terminal"; id: string }
  | { kind: "file"; path: string };

export interface ProjectState {
  root: string | null;
  selectedFile: string | null;
  file: FileContent | null;
  secrets: SecretMeta[];
  config: ProjectConfig | null;
  gitStatus: GitStatus | null;
  diff: AppState["diff"]; // the {path,which,original,modified}|null shape
  dbView: DbView | null;
  settingsOpen: boolean;
  // Unified main area: the open file editor TABS (relPaths; the tab bar shows
  // these alongside the terminals). The PRIMARY pane is the selected tab --
  // mainPrimary picks terminal (activeTerminalId) vs editor (selectedFile/file).
  // mainSecondary is the split partner (any tab) shown beside it, or null.
  editorTabs: string[];
  mainPrimary: "terminal" | "editor";
  mainSecondary: PaneItem | null;
  // The unified tab-bar order: terminals AND files interleaved by creation/open
  // order, so a NEW tab always appears at the far-right end (not grouped by
  // type). MainTabs renders in this order; terminal/file membership still lives
  // in tabTerminals / editorTabs, this is purely the left-to-right ordering.
  mainTabOrder: PaneItem[];
}

const freshProjectState = (root: string | null): ProjectState => ({
  root,
  selectedFile: null,
  file: null,
  secrets: [],
  config: null,
  gitStatus: null,
  diff: null,
  dbView: null,
  settingsOpen: false,
  editorTabs: [],
  mainPrimary: "terminal", // a fresh tab shows its terminal until a file opens
  mainSecondary: null,
  mainTabOrder: [],
});

let projCounter = 0;
const newTabId = (): string => `proj-${++projCounter}`;

// The window ALWAYS has >= 1 tab: the initial state is a single BLANK tab (root
// null) with a real id, so a blank tab renders today's no-folder UI plus a
// working terminal as a first-class tab in the strip. (The old implicit
// activeTabId-null state and IMPLICIT_TAB_ID are retired.)
const INITIAL_TAB_ID = newTabId();

interface AppState {
  // --- Active-tab per-project state MIRROR (top level so existing components
  // that read s.root / s.selectedFile / ... keep working unchanged). This is a
  // copy of tabState[activeTabId]; the SOURCE OF TRUTH is tabState. ---
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
  // Unified main-area view (mirror of the active tab's ProjectState).
  editorTabs: string[];
  mainPrimary: "terminal" | "editor";
  mainSecondary: PaneItem | null;
  mainTabOrder: PaneItem[];

  // --- Tab model ---
  tabs: { id: string; root: string | null }[]; // tab order; root null = a BLANK tab
  activeTabId: string; // non-null (FOCUSED pane): the window always has >= 1 tab
  split: { a: string; b: string } | null; // the split PAIR (a=left/primary, b=right/secondary); null = no split. Shown iff activeTabId is a or b.
  tabState: Record<string, ProjectState>; // SOURCE OF TRUTH: per-project state for EVERY tab
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
  switchTab: (id: string) => void; // focus tab id (clicking a tab OR a pane)
  closeTab: (id: string) => void;
  applyPtyStatus: (ptyId: string, working: boolean) => void;
  setOpenProjectsAsTabs: (v: boolean) => void;
  setShowRunningProcessNotice: (v: boolean) => void;

  // --- Split actions ---
  toggleProjectSplit: () => void; // un-split if the split is showing, else split the active tab with a NEW blank secondary
  splitActiveWith: (partnerId: string) => void; // split active (primary) + partnerId (secondary); blank secondary if partnerId is the active tab / unknown

  // --- Per-project setters ---
  // Each updates tabState[tabId] (default = the ACTIVE tab) and mirrors to the
  // top level ONLY when tabId is the active tab. Existing callers omit tabId ->
  // active -> identical single-pane behavior. The split pane passes its tabId.
  setRoot: (root: string | null) => void; // thin adapter -> openProject/closeTab
  setSelected: (
    relPath: string | null,
    file: FileContent | null,
    tabId?: string,
  ) => void;
  // Open a file as an editor tab (adds to editorTabs, makes it the active editor
  // file, and switches the main area to the editor). FileTree + the tab bar call
  // it after reading the content.
  openFile: (relPath: string, file: FileContent, tabId?: string) => void;
  // Close an editor tab. If it was the active file, the active selection is
  // cleared and the main area falls back to the terminal (the caller activates a
  // neighbor file first when one exists).
  closeEditorTab: (relPath: string, tabId?: string) => void;
  // Which content is the PRIMARY pane (the active terminal vs the active editor
  // file). Setting it collapses any split (clicking a tab shows just that tab).
  setMainPrimary: (primary: "terminal" | "editor", tabId?: string) => void;
  // Split: show `item` (any tab) as the SECONDARY pane beside the primary.
  splitWith: (item: PaneItem, tabId?: string) => void;
  unsplit: (tabId?: string) => void;
  setDiff: (diff: AppState["diff"], tabId?: string) => void;
  setDbView: (v: DbView | null, tabId?: string) => void;
  setSecrets: (secrets: SecretMeta[], tabId?: string) => void;
  setConfig: (config: ProjectConfig | null, tabId?: string) => void;
  setGitStatus: (gitStatus: GitStatus | null, tabId?: string) => void;
  setModal: (modal: AppState["modal"]) => void;

  // --- Terminal setters ---
  // addTerminal/setActiveTerminal/setSplit take the PANE's tabId (the terminal-
  // tabs UI passes ITS tabId) so they hit the right pane even in a project split;
  // tabId defaults to the active tab. setTerminalPty/Title/removeTerminal find the
  // tab that OWNS the terminal id (a background tab's pane can fire these on adopt
  // / OSC title / process exit), so they must NOT assume the active tab.
  addTerminal: (tabId?: string) => string; // returns new id, sets it active (in tabId or the active tab)
  removeTerminal: (id: string) => void;
  setActiveTerminal: (id: string, tabId?: string) => void;
  setTerminalPty: (id: string, ptyId: string) => void;
  setTerminalTitle: (id: string, title: string, fromUser: boolean) => void;
  setSplit: (id: string | null, tabId?: string) => void;

  // --- App-global setters ---
  setSidebarVisible: (v: boolean) => void;
  toggleSidebar: () => void;
  setSidebarPosition: (p: "left" | "right") => void;
  toggleSidebarPosition: () => void;
  setTheme: (t: "dark" | "light") => void;
  setClipboardClearSeconds: (n: number) => void;
  setSectionVisibility: (v: SectionVisibility) => void;
  setSettingsOpen: (v: boolean, tabId?: string) => void;
  setLayoutHydrated: (v: boolean) => void;
}

// The top-level mirror fields for a given ProjectState (root + the per-project
// set). Spread into a set() to sync the top level to a tab's state.
const mirrorOf = (ps: ProjectState): Pick<AppState, keyof ProjectState> => ({
  root: ps.root,
  selectedFile: ps.selectedFile,
  file: ps.file,
  secrets: ps.secrets,
  config: ps.config,
  gitStatus: ps.gitStatus,
  diff: ps.diff,
  dbView: ps.dbView,
  settingsOpen: ps.settingsOpen,
  editorTabs: ps.editorTabs,
  mainPrimary: ps.mainPrimary,
  mainSecondary: ps.mainSecondary,
  mainTabOrder: ps.mainTabOrder,
});

// Patch one tab's ProjectState (the source of truth); ALSO mirror to the top
// level IFF that tab is the active (focused) one. Returns the partial set().
const patchTab = (
  s: AppState,
  tabId: string,
  patch: Partial<ProjectState>,
): Partial<AppState> => {
  const next = { ...(s.tabState[tabId] ?? freshProjectState(null)), ...patch };
  const tabState = { ...s.tabState, [tabId]: next };
  return tabId === s.activeTabId
    ? { tabState, ...mirrorOf(next) }
    : { tabState };
};

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
// used to route a per-session working update to the tab whose dot it drives.
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

// A tab is VISIBLE (the user can see it right now) when it is the active tab,
// or -- when a split is SHOWING (the active tab is one of the pair) -- either
// member of that pair. This is the single definition of "the user is looking at
// it": the finished-glow must never fire for (and must clear on) a visible tab,
// and the empty-tab terminal respawn keys on it too. Without this the secondary
// split pane (visible, but != activeTabId) wrongly glowed while on screen.
export const isVisibleTab = (
  activeTabId: string,
  split: { a: string; b: string } | null,
  tabId: string,
): boolean => {
  if (tabId === activeTabId) return true;
  const showing =
    split !== null && (split.a === activeTabId || split.b === activeTabId);
  return showing && split !== null && (split.a === tabId || split.b === tabId);
};

// Report the window's full set of OPEN tab roots to main (every tab that has a
// folder). Main validates a per-project IPC's explicit root against this set
// (resolveRoot), so the renderer can only point a handler at a project the user
// actually opened. Called at the end of every action that can change the set of
// open roots (openProject/openBlankTab/fillActiveTab/replaceActiveProject/
// closeTab). Fire-and-forget; guarded so a missing API (e.g. tests) never
// throws, mirroring how switchTab fires workspaceSetActive.
const reportOpenRoots = (tabs: { root: string | null }[]): void => {
  const roots = tabs.map((t) => t.root).filter((r): r is string => !!r);
  void window.airlock?.workspaceRoots?.(roots);
};

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
  // active-tab per-project MIRROR (a copy of tabState[INITIAL_TAB_ID], which is
  // freshProjectState(null) for the initial blank tab).
  root: null,
  selectedFile: null,
  file: null,
  secrets: [],
  config: null,
  gitStatus: null,
  settingsOpen: false,
  dbView: null,
  diff: null,
  editorTabs: [],
  mainPrimary: "terminal",
  mainSecondary: null,
  mainTabOrder: [],

  // tab model — start with ONE blank tab (root null). The window always has
  // >= 1 tab; a blank tab renders the existing no-folder empty state and a
  // working terminal, so a default shell can spawn before any folder is opened.
  // tabState is the source of truth (one entry per tab); split starts null.
  tabs: [{ id: INITIAL_TAB_ID, root: null }],
  activeTabId: INITIAL_TAB_ID,
  split: null,
  tabState: { [INITIAL_TAB_ID]: freshProjectState(null) },
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
  // mode) and make it active with fresh empty terminals. The outgoing active
  // tab's state already lives in tabState (no parking); we add the new tab's
  // ProjectState and mirror it to the top level.
  openProject: (root) => {
    set((s) => {
      const id = newTabId();
      const state = freshProjectState(root);
      return {
        tabs: [...s.tabs, { id, root }],
        activeTabId: id,
        tabState: { ...s.tabState, [id]: state },
        tabTerminals: { ...s.tabTerminals, [id]: emptyTabTerminals() },
        // mirror the new tab's state to the top level
        ...mirrorOf(state),
        // a freshly opened project starts with no modal carried over
        modal: null,
      };
    });
    // The set of open roots grew -> tell main (for resolveRoot validation).
    reportOpenRoots(useApp.getState().tabs);
  },
  // Append a BLANK tab (no folder) and make it active. The tab-strip `+` calls
  // this -- NO folder picker. Fresh ProjectState + empty terminals.
  openBlankTab: () => {
    set((s) => {
      const id = newTabId();
      const state = freshProjectState(null);
      return {
        tabs: [...s.tabs, { id, root: null }],
        activeTabId: id,
        tabState: { ...s.tabState, [id]: state },
        tabTerminals: { ...s.tabTerminals, [id]: emptyTabTerminals() },
        ...mirrorOf(state),
        modal: null,
      };
    });
    // A blank tab adds no root, but reporting keeps main's set authoritative.
    reportOpenRoots(useApp.getState().tabs);
  },
  // Attach a folder to the active BLANK tab IN PLACE, KEEPING its terminals (so
  // a live `claude`/server in the blank tab's shell survives the attach). The
  // tab gets fresh project fields for the new root. (Idle/busy handling later.)
  fillActiveTab: (root) => {
    set((s) => {
      const id = s.activeTabId;
      const state = freshProjectState(root);
      return {
        tabs: s.tabs.map((t) => (t.id === id ? { id, root } : t)),
        tabState: { ...s.tabState, [id]: state },
        // tabTerminals[id] is intentionally NOT reset -- the blank tab's
        // terminal(s) survive the attach.
        ...mirrorOf(state),
        modal: null,
      };
    });
    // A blank tab gained a folder -> the open-roots set changed.
    reportOpenRoots(useApp.getState().tabs);
  },
  // Windows-mode "replace the window's single project in place" (active tab
  // already HAS a project): swap the ACTIVE tab's root rather than appending a
  // tab, give it fresh project fields, and reset that tab's terminals to a fresh
  // empty set so the old project's TerminalPanes unmount and their ptys die.
  replaceActiveProject: (root) => {
    set((s) => {
      const id = s.activeTabId;
      const state = freshProjectState(root);
      return {
        tabs: s.tabs.map((t) => (t.id === id ? { id, root } : t)),
        tabState: { ...s.tabState, [id]: state },
        tabTerminals: { ...s.tabTerminals, [id]: emptyTabTerminals() },
        ...mirrorOf(state),
        modal: null,
      };
    });
    // The active tab's root was swapped -> the open-roots set changed.
    reportOpenRoots(useApp.getState().tabs);
  },
  // Focus tab id (clicking a tab OR a pane). Every tab's state is always live in
  // tabState, so this just re-points the top-level mirror at the focused tab. It
  // does NOT touch `split`: the pair persists, and the layout shows the split iff
  // the focused tab is a member of the pair -- so focusing a non-pair tab HIDES
  // the split (it stays in the strip) and focusing a pair member shows it again.
  switchTab: (id) => {
    set((s) => {
      if (id === s.activeTabId) return {};
      if (!s.tabs.some((t) => t.id === id)) return {}; // unknown id -> no-op
      // Activating a tab dismisses its finished-glow (the user is now looking).
      // If the switch SHOWS a split (id is a pair member), BOTH members become
      // visible, so clear the partner's glow too -- else the unified tab keeps
      // glowing while the user is plainly looking at it.
      const tabGlow = { ...s.tabGlow };
      delete tabGlow[id];
      if (s.split && (s.split.a === id || s.split.b === id)) {
        delete tabGlow[s.split.a];
        delete tabGlow[s.split.b];
      }
      return {
        activeTabId: id,
        tabGlow,
        ...mirrorOf(s.tabState[id] ?? freshProjectState(null)),
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
      const tabState = { ...s.tabState };
      delete tabState[id];
      // Drop the closed tab's glow flag (cosmetic cleanup; no tab references it).
      const tabGlow = { ...s.tabGlow };
      delete tabGlow[id];
      // Closing either member dissolves the split; the OTHER member stays a
      // normal tab. otherId is the survivor, promoted when the closed tab was
      // the focused one (so the survivor becomes the single view).
      const pair = s.split;
      const split = pair && (pair.a === id || pair.b === id) ? null : pair;
      const otherId =
        pair && pair.a === id ? pair.b : pair && pair.b === id ? pair.a : null;

      if (id !== s.activeTabId) {
        // Closing a background tab: active stays put, mirror unchanged.
        return { tabs, tabState, tabTerminals, tabGlow, split };
      }

      // Closing the active (focused) tab: promote the surviving split member if
      // there was one, else the tab-order neighbor (prev, then next).
      const survivor = otherId
        ? (tabs.find((t) => t.id === otherId) ?? null)
        : null;
      const promote = survivor ?? tabs[idx - 1] ?? tabs[idx] ?? null;
      if (promote) {
        promotedRoot = promote.root; // may be null (blank)
        clearMain = promote.root === null;
        return {
          tabs,
          tabState,
          tabTerminals,
          tabGlow,
          split,
          activeTabId: promote.id,
          ...mirrorOf(tabState[promote.id] ?? freshProjectState(null)),
        };
      }
      // Closed the LAST tab -> open a fresh BLANK tab so the window keeps >= 1
      // tab (instead of the old activeTabId-null no-project state).
      const blankId = newTabId();
      clearMain = true;
      const blankState = freshProjectState(null);
      return {
        tabs: [{ id: blankId, root: null }],
        tabState: { [blankId]: blankState },
        tabTerminals: { [blankId]: emptyTabTerminals() },
        tabGlow: {},
        activeTabId: blankId,
        split: null,
        ...mirrorOf(blankState),
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
    // A tab was removed (or the last close replaced it with a blank) -> the
    // open-roots set changed; re-report so main's resolveRoot stays in sync.
    reportOpenRoots(useApp.getState().tabs);
  },
  // Per-session working update (from TerminalPane's indicator scan) -> per-tab
  // state. Record the session's working bit, then drive the OWNING tab's glow
  // on a working->done edge:
  // - working (after): clear any finished-glow (it is busy, not waiting).
  // - just finished (before working, after not) in a tab the user is NOT looking
  //   at: glow, so they know to switch back. A VISIBLE tab never glows -- guarded
  //   by isVisibleTab, which counts BOTH members of a showing split as visible
  //   (the secondary pane is on screen yet != activeTabId, so the old
  //   activeTabId check wrongly glowed it). The dot color itself is derived in
  //   the view from sessionWorking; only the glow is stored.
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
      } else if (before && !isVisibleTab(s.activeTabId, s.split, owningTab)) {
        // just finished in a tab the user cannot see -> glow
        tabGlow = { ...s.tabGlow, [owningTab]: true };
      }
      return { sessionWorking, tabGlow };
    }),
  setOpenProjectsAsTabs: (openProjectsAsTabs) => set({ openProjectsAsTabs }),
  setShowRunningProcessNotice: (showRunningProcessNotice) =>
    set({ showRunningProcessNotice }),

  // --- Split actions ---
  // The split button. If the split is currently SHOWING (the active tab is a
  // member of the pair), collapse it (split -> null; both tabs stay separate).
  // Otherwise split the active tab (primary/left) with a brand-new BLANK
  // secondary (right) and keep the active focused.
  toggleProjectSplit: () => {
    let added = false;
    set((s) => {
      const showing =
        s.split !== null &&
        (s.split.a === s.activeTabId || s.split.b === s.activeTabId);
      if (showing) return { split: null };
      const b = newTabId();
      added = true;
      return {
        tabs: [...s.tabs, { id: b, root: null }],
        tabState: { ...s.tabState, [b]: freshProjectState(null) },
        tabTerminals: { ...s.tabTerminals, [b]: emptyTabTerminals() },
        split: { a: s.activeTabId, b },
      };
    });
    if (added) reportOpenRoots(useApp.getState().tabs);
  },
  // Split the active tab (primary/left) with `partnerId` (secondary/right) -- the
  // right-click "Split" path. If partnerId is the active tab or not a real tab,
  // fall back to a fresh blank secondary (same as the button).
  splitActiveWith: (partnerId) => {
    let added = false;
    set((s) => {
      if (
        partnerId !== s.activeTabId &&
        s.tabs.some((t) => t.id === partnerId)
      ) {
        // The partner becomes visible (right pane), so clear any finished-glow.
        const tabGlow = { ...s.tabGlow };
        delete tabGlow[partnerId];
        return { split: { a: s.activeTabId, b: partnerId }, tabGlow };
      }
      const b = newTabId();
      added = true;
      return {
        tabs: [...s.tabs, { id: b, root: null }],
        tabState: { ...s.tabState, [b]: freshProjectState(null) },
        tabTerminals: { ...s.tabTerminals, [b]: emptyTabTerminals() },
        split: { a: s.activeTabId, b },
      };
    });
    if (added) reportOpenRoots(useApp.getState().tabs);
  },

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
  // Per-project setters route through patchTab: update tabState[tabId] (default
  // the active tab) and mirror to the top level only when tabId is active.
  setSelected: (selectedFile, file, tabId) =>
    set((s) =>
      patchTab(s, tabId ?? s.activeTabId, {
        selectedFile,
        file,
        diff: null,
        settingsOpen: false,
        dbView: null,
      }),
    ),
  openFile: (relPath, file, tabId) =>
    set((s) => {
      const tid = tabId ?? s.activeTabId;
      const cur = s.tabState[tid] ?? freshProjectState(null);
      const editorTabs = cur.editorTabs.includes(relPath)
        ? cur.editorTabs
        : [...cur.editorTabs, relPath];
      // Append the file at the far-right end of the unified tab order (once).
      const mainTabOrder: PaneItem[] = cur.mainTabOrder.some(
        (it) => it.kind === "file" && it.path === relPath,
      )
        ? cur.mainTabOrder
        : [...cur.mainTabOrder, { kind: "file", path: relPath }];
      return patchTab(s, tid, {
        editorTabs,
        mainTabOrder,
        selectedFile: relPath,
        file,
        mainPrimary: "editor",
        mainSecondary: null, // opening a file as primary collapses any split
        // Opening a file dismisses any overlay (diff/settings/db) so the editor shows.
        diff: null,
        settingsOpen: false,
        dbView: null,
      });
    }),
  closeEditorTab: (relPath, tabId) =>
    set((s) => {
      const tid = tabId ?? s.activeTabId;
      const cur = s.tabState[tid];
      if (!cur) return {};
      const editorTabs = cur.editorTabs.filter((p) => p !== relPath);
      // Drop the file from the unified tab order.
      const mainTabOrder = cur.mainTabOrder.filter(
        (it) => !(it.kind === "file" && it.path === relPath),
      );
      // If the closed file was the secondary pane, collapse that pane too.
      const dropSecondary =
        cur.mainSecondary?.kind === "file" &&
        cur.mainSecondary.path === relPath;
      // Closing the ACTIVE file clears the selection and falls back to the
      // terminal (the caller activates a neighbor file first when one exists).
      return patchTab(
        s,
        tid,
        relPath === cur.selectedFile
          ? {
              editorTabs,
              mainTabOrder,
              selectedFile: null,
              file: null,
              mainPrimary: "terminal",
              ...(dropSecondary ? { mainSecondary: null } : {}),
            }
          : {
              editorTabs,
              mainTabOrder,
              ...(dropSecondary ? { mainSecondary: null } : {}),
            },
      );
    }),
  setMainPrimary: (primary, tabId) =>
    set((s) =>
      patchTab(s, tabId ?? s.activeTabId, {
        mainPrimary: primary,
        mainSecondary: null, // clicking a tab collapses to a single pane
        // Showing the editor/terminal dismisses any overlay (diff/settings/db).
        diff: null,
        settingsOpen: false,
        dbView: null,
      }),
    ),
  splitWith: (item, tabId) =>
    set((s) =>
      patchTab(s, tabId ?? s.activeTabId, {
        mainSecondary: item,
        // The split shows the editor/terminal panes, so dismiss any overlay.
        diff: null,
        settingsOpen: false,
        dbView: null,
      }),
    ),
  unsplit: (tabId) =>
    set((s) => patchTab(s, tabId ?? s.activeTabId, { mainSecondary: null })),
  // Overlays (diff/settings/db) sit ON TOP of the editor/terminal: they clear
  // each other (one overlay at a time) but NOT selectedFile/editorTabs, so the
  // editor is restored when the overlay closes.
  setDiff: (diff, tabId) =>
    set((s) =>
      patchTab(s, tabId ?? s.activeTabId, {
        diff,
        settingsOpen: false,
        dbView: null,
      }),
    ),
  setSecrets: (secrets, tabId) =>
    set((s) => patchTab(s, tabId ?? s.activeTabId, { secrets })),
  setConfig: (config, tabId) =>
    set((s) => patchTab(s, tabId ?? s.activeTabId, { config })),
  setGitStatus: (gitStatus, tabId) =>
    set((s) => patchTab(s, tabId ?? s.activeTabId, { gitStatus })),
  setModal: (modal) => set({ modal }),
  setRunningNotice: (runningNotice) => set({ runningNotice }),

  // --- Terminal setters ---
  addTerminal: (tabId) => {
    const entry = newEntry();
    set((s) => {
      // Target the given pane's tab (the terminal-tabs UI passes ITS tabId), so
      // adding a terminal in a SPLIT pane hits that pane -- not the focused one.
      const tid = tabId ?? s.activeTabId;
      const tt = s.tabTerminals[tid] ?? emptyTabTerminals();
      // Append the new terminal at the FAR-RIGHT end of the unified tab order.
      const cur = s.tabState[tid];
      const orderPatch = cur
        ? patchTab(s, tid, {
            mainTabOrder: [
              ...cur.mainTabOrder,
              { kind: "terminal", id: entry.id },
            ],
          })
        : {};
      return {
        tabTerminals: {
          ...s.tabTerminals,
          [tid]: {
            ...tt,
            terminals: [...tt.terminals, entry],
            activeTerminalId: entry.id,
          },
        },
        ...orderPatch,
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
      const cur = s.tabState[tabId];
      // Drop it from the unified tab order, and -- if it was the SECONDARY pane
      // -- collapse that pane. Both go in one patchTab.
      const tabPatch: Partial<ProjectState> = {};
      if (cur) {
        tabPatch.mainTabOrder = cur.mainTabOrder.filter(
          (it) => !(it.kind === "terminal" && it.id === id),
        );
        if (
          cur.mainSecondary?.kind === "terminal" &&
          cur.mainSecondary.id === id
        )
          tabPatch.mainSecondary = null;
      }
      return {
        tabTerminals: { ...s.tabTerminals, [tabId]: removeFromTab(tt, id) },
        ...(cur ? patchTab(s, tabId, tabPatch) : {}),
      };
    }),
  setActiveTerminal: (id, tabId) =>
    set((s) => {
      const tid = tabId ?? s.activeTabId;
      const tt = s.tabTerminals[tid];
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
      return { tabTerminals: { ...s.tabTerminals, [tid]: next } };
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
  setSplit: (id, tabId) =>
    set((s) => {
      const tid = tabId ?? s.activeTabId;
      const tt = s.tabTerminals[tid];
      if (!tt) return {};
      return {
        tabTerminals: {
          ...s.tabTerminals,
          [tid]: { ...tt, splitTerminalId: id },
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
  // Settings is an OVERLAY: opening it clears the other overlays (diff/dbView)
  // but NOT the editor (selectedFile/editorTabs), so closing it restores the
  // editor/terminal underneath. Closing leaves the rest untouched.
  setSettingsOpen: (v, tabId) =>
    set((s) =>
      patchTab(s, tabId ?? s.activeTabId, {
        settingsOpen: v,
        ...(v ? { diff: null, dbView: null } : {}),
      }),
    ),
  // Browsing a DB table is an overlay too: clears diff/settings (one overlay at
  // a time) but keeps the editor underneath. Passing null closes the data grid.
  setDbView: (v, tabId) =>
    set((s) =>
      patchTab(s, tabId ?? s.activeTabId, {
        dbView: v,
        ...(v ? { diff: null, settingsOpen: false } : {}),
      }),
    ),
  setLayoutHydrated: (v) => set({ layoutHydrated: v }),
}));
