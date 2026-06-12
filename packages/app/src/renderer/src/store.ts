import { create } from "zustand";
import type {
  AnthropicStatus,
  ClaudeAutoStart,
  FileContent,
  GitStatus,
  ProjectConfig,
  QuotaStatus,
  ReferenceResults,
  SearchResults,
  SecretMeta,
  Section,
  SectionVisibility,
  UpdateProgress,
  UpdateStatus,
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
  // Terminal currently holding this tab's auto-Claude claim ("first" mode):
  // set by claudeAutoDecision at pty adoption, released when that terminal is
  // removed. null = free.
  claudeAutoId: string | null;
}

const emptyTabTerminals = (): TabTerminals => ({
  terminals: [],
  activeTerminalId: null,
  splitTerminalId: null,
  claudeAutoId: null,
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
  claudeAutoId: null,
};

// The exact bytes the "Start Claude here" notice writes: run claude INSIDE the
// shell so exiting it returns to the prompt.
export const CLAUDE_AUTO_COMMAND = "claude\n";

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

// Structural equality for pane items (same terminal id / same file path).
export const samePaneItem = (a: PaneItem, b: PaneItem): boolean =>
  a.kind === "terminal"
    ? b.kind === "terminal" && a.id === b.id
    : b.kind === "file" && a.path === b.path;

// The scene shown for `current`: the split pair containing it ([left,right]),
// else `current` alone (right = null). The single source the UI renders from.
export const shownScene = (
  splits: [PaneItem, PaneItem][],
  current: PaneItem | null,
): { left: PaneItem | null; right: PaneItem | null } => {
  if (!current) return { left: null, right: null };
  const pair = splits.find(
    (p) => samePaneItem(p[0], current) || samePaneItem(p[1], current),
  );
  if (pair) return { left: pair[0], right: pair[1] };
  return { left: current, right: null };
};

// Derive the stored view mirror (mainPrimary/mainSecondary/selectedFile + the
// tab's activeTerminalId) from the scene. selectedFile is the file ON SCREEN
// (left if a file, else right) so FileTree highlights it; activeTerminalId is
// the terminal on screen (left if a terminal, else right) for restart/agent.
const deriveView = (
  splits: [PaneItem, PaneItem][],
  current: PaneItem | null,
): {
  mainPrimary: "terminal" | "editor";
  mainSecondary: PaneItem | null;
  selectedFile: string | null;
  activeTerminalId: string | null;
} => {
  const { left, right } = shownScene(splits, current);
  return {
    mainPrimary: left?.kind === "file" ? "editor" : "terminal",
    mainSecondary: right,
    selectedFile:
      left?.kind === "file"
        ? left.path
        : right?.kind === "file"
          ? right.path
          : null,
    activeTerminalId:
      left?.kind === "terminal"
        ? left.id
        : right?.kind === "terminal"
          ? right.id
          : null,
  };
};

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
  // these alongside the terminals).
  editorTabs: string[];
  // The unified tab-bar order: terminals AND files interleaved by creation/open
  // order, so a NEW tab always appears at the far-right end (not grouped by
  // type). MainTabs renders in this order; terminal/file membership still lives
  // in tabTerminals / editorTabs, this is purely the left-to-right ordering.
  mainTabOrder: PaneItem[];
  // --- Multi-split "scene" model (SOURCE OF TRUTH) ---
  // `splits` is the set of COEXISTING split pairs ([left, right]); each tab is in
  // at most one pair. `current` is the focused tab; the scene shown is the split
  // containing `current` (if any), else `current` alone. Showing one tab never
  // destroys another's split. mainPrimary/mainSecondary/selectedFile (+ the tab's
  // activeTerminalId) are DERIVED from these on every change so the rendering and
  // outside consumers (FileTree, restart, openFolder) keep working unchanged.
  splits: [PaneItem, PaneItem][];
  current: PaneItem | null;
  // Derived view (the SHOWN scene): mainPrimary = the left pane's kind (terminal
  // shows activeTerminalId, editor shows selectedFile); mainSecondary = the right
  // pane (null = single). Recomputed by deriveView; do not set directly.
  mainPrimary: "terminal" | "editor";
  mainSecondary: PaneItem | null;
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
  mainTabOrder: [],
  splits: [],
  current: null,
  mainPrimary: "terminal", // a fresh tab shows its terminal until a file opens
  mainSecondary: null,
});

let projCounter = 0;
const newTabId = (): string => `proj-${++projCounter}`;

// The window ALWAYS has >= 1 tab: the initial state is a single BLANK tab (root
// null) with a real id, so a blank tab renders today's no-folder UI plus a
// working terminal as a first-class tab in the strip. (The old implicit
// activeTabId-null state and IMPLICIT_TAB_ID are retired.)
const INITIAL_TAB_ID = newTabId();

export interface AppState {
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
  mainTabOrder: PaneItem[];
  splits: [PaneItem, PaneItem][];
  current: PaneItem | null;
  mainPrimary: "terminal" | "editor";
  mainSecondary: PaneItem | null;

  // --- Tab model ---
  tabs: { id: string; root: string | null }[]; // tab order; root null = a BLANK tab
  activeTabId: string; // non-null (FOCUSED pane): the window always has >= 1 tab
  split: { a: string; b: string } | null; // the split PAIR (a=left/primary, b=right/secondary); null = no split. Shown iff activeTabId is a or b.
  tabState: Record<string, ProjectState>; // SOURCE OF TRUTH: per-project state for EVERY tab
  tabTerminals: Record<string, TabTerminals>; // per-tab terminals (active + inactive all mounted)
  sessionWorking: Record<string, boolean>; // ptyId -> claude actively working
  tabGlow: Record<string, boolean>; // tabId -> finished-in-background, awaiting a look
  tabRenames: Record<string, string>; // tabId -> custom display label (display-only; never touches the folder on disk; session-scoped)
  openProjectsAsTabs: boolean; // app-global (persisted); used by later tasks
  showRunningProcessNotice: boolean; // app-global (persisted); gates the kept-busy-terminal notice

  // --- App-global (shared across tabs) ---
  sidebarVisible: boolean; // app-global (persisted), not per-project
  sidebarPosition: "left" | "right"; // app-global (persisted), not per-project
  theme: "dark" | "light"; // app-global (persisted), drives data-theme on <html>
  clipboardClearSeconds: number; // app-global (persisted), seconds before clipboard auto-clears (0 = never)
  quota: QuotaStatus | null;
  setQuota: (q: QuotaStatus) => void;
  quotaMeterEnabled: boolean;
  setQuotaMeterEnabled: (v: boolean) => void;
  anthropicStatus: AnthropicStatus | null;
  setAnthropicStatus: (s: AnthropicStatus) => void;
  update: UpdateStatus | null;
  setUpdate: (s: UpdateStatus) => void;
  updateProgress: UpdateProgress;
  setUpdateProgress: (p: UpdateProgress) => void;
  sectionVisibility: SectionVisibility; // app-global (persisted), gates sidebar sections
  activeView: Section; // app-global (persisted): which section the sidebar shows (activity bar)
  claudeAutoStart: ClaudeAutoStart; // app-global (persisted): auto-run claude in new project terminals
  defaultTerminal: string; // app-global (persisted): "airlock" or a terminal id
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
  renameTab: (tabId: string, name: string) => void; // set/clear (empty name) a tab's display label
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
  // Rewrite every reference to `fromRel` in the tab's open editor tabs, tab
  // order, splits, and current focus to `toRel`. Handles both exact-path renames
  // and folder renames (any path that starts with `fromRel/` is rebased). Derived
  // fields (selectedFile / mainPrimary / mainSecondary) are recomputed via setView.
  renameFilePath: (fromRel: string, toRel: string, tabId?: string) => void;
  // Scene model. viewItem: focus `item` -> the main area shows its split (if it
  // is in one) or `item` alone; never destroys another split. splitItems: pair
  // `a` (left) with `b` (right) into a NEW coexisting split, pulling either out
  // of a prior split first, and focus it. unsplitCurrent: break only the split
  // the focused tab is in.
  viewItem: (item: PaneItem, tabId?: string) => void;
  splitItems: (a: PaneItem, b: PaneItem, tabId?: string) => void;
  unsplitCurrent: (tabId?: string) => void;
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
  // Should the terminal that just adopted its pty auto-run claude? Atomic:
  // in "first" mode a true return ALSO takes the tab's claim. False for
  // blank tabs, unknown ids, and mode "off".
  claudeAutoDecision: (terminalId: string) => boolean;

  // --- App-global setters ---
  setSidebarVisible: (v: boolean) => void;
  toggleSidebar: () => void;
  setSidebarPosition: (p: "left" | "right") => void;
  toggleSidebarPosition: () => void;
  setTheme: (t: "dark" | "light") => void;
  setClipboardClearSeconds: (n: number) => void;
  setSectionVisibility: (v: SectionVisibility) => void;
  setActiveView: (v: Section) => void;
  setClaudeAutoStart: (v: ClaudeAutoStart) => void;
  setDefaultTerminal: (v: string) => void;
  openExternalTerminal: (tabId: string) => void;
  setSettingsOpen: (v: boolean, tabId?: string) => void;
  // The command/quick-open palette overlay (window-level, one per window).
  palette: { mode: "files" | "commands" } | null;
  openPalette: (mode: "files" | "commands") => void;
  closePalette: () => void;
  // Find-in-files (window-level, like the palette). searchOpen = panel visible;
  // search = the last query + its results (kept so reopening is instant).
  searchOpen: boolean;
  search: { query: string; results: SearchResults } | null;
  setSearchOpen: (v: boolean) => void;
  // references = the last Find-All-References symbol + grouped results; null =
  // closed. The overlay is always mounted and renders null when this is null.
  references: { symbol: string; results: ReferenceResults } | null;
  setReferences: (symbol: string, results: ReferenceResults) => void;
  closeReferences: () => void;
  // --- IDE-level pages (Settings / Usage): tabs in the PROJECT strip. They
  // are app chrome, not project content, so they live beside the project
  // tabs; BOTH can be open at once, `appPage` selects which one is SHOWN
  // (replacing the panes area; selecting a project tab hides the page but
  // keeps its tab open). ---
  appPage: "settings" | "usage" | null;
  settingsTabOpen: boolean;
  usageTabOpen: boolean;
  openAppPage: (p: "settings" | "usage") => void; // open the tab + show it
  showAppPage: (p: "settings" | "usage") => void; // click an already-open tab
  closeAppPage: (p: "settings" | "usage") => void; // the tab's X
  setSearchResults: (query: string, results: SearchResults) => void;
  // A one-shot "scroll the editor to this line" signal, keyed by tabId+path and
  // consumed by EditorPane. nonce makes repeated clicks on the same line retrigger.
  reveal: { tabId: string; path: string; line: number; nonce: number } | null;
  revealLine: (tabId: string, path: string, line: number) => void;
  setLayoutHydrated: (v: boolean) => void;
  fsVersion: Record<string, number>;
  bumpFsVersion: (root: string) => void;
  // Per-folder custom file order, keyed by root then folderRel ("." = that
  // root's top level). Loaded from the committed .airlock-order.json
  // (loadFileOrder) and written through on reorder (setFolderOrder). An absent
  // folder key means default sort.
  fileOrder: Record<string, Record<string, string[]>>;
  loadFileOrder: (root: string) => Promise<void>;
  setFolderOrder: (
    root: string,
    folderRel: string,
    names: string[],
  ) => Promise<void>;
  // One-shot signal from the FILES header's New File/Folder buttons to that
  // tab's FileTree, which opens an inline create input at the root and clears it.
  newFileRequest: { tabId: string; kind: "file" | "dir" } | null;
  requestNewFile: (tabId: string, kind: "file" | "dir") => void;
  clearNewFileRequest: () => void;
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
  mainTabOrder: ps.mainTabOrder,
  splits: ps.splits,
  current: ps.current,
  mainPrimary: ps.mainPrimary,
  mainSecondary: ps.mainSecondary,
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

// Set a tab's scene (splits + current) and recompute its derived view fields
// (mainPrimary/mainSecondary/selectedFile via patchTab, and the tab's
// activeTerminalId). `extra` carries any other ProjectState fields to patch in
// the same set (e.g. editorTabs/mainTabOrder, or overlay clears).
const setView = (
  s: AppState,
  tabId: string,
  splits: [PaneItem, PaneItem][],
  current: PaneItem | null,
  extra: Partial<ProjectState> = {},
): Partial<AppState> => {
  const d = deriveView(splits, current);
  const tt = s.tabTerminals[tabId];
  return {
    ...patchTab(s, tabId, {
      splits,
      current,
      mainPrimary: d.mainPrimary,
      mainSecondary: d.mainSecondary,
      selectedFile: d.selectedFile,
      ...extra,
    }),
    ...(tt
      ? {
          tabTerminals: {
            ...s.tabTerminals,
            [tabId]: { ...tt, activeTerminalId: d.activeTerminalId },
          },
        }
      : {}),
  };
};

// Remove an item from every split pair it appears in (used when a tab is
// re-split elsewhere, closed, or killed). A pair that loses a member is dropped
// entirely (its other member becomes a single tab again).
const dropFromSplits = (
  splits: [PaneItem, PaneItem][],
  item: PaneItem,
): [PaneItem, PaneItem][] =>
  splits.filter((p) => !samePaneItem(p[0], item) && !samePaneItem(p[1], item));

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
  return {
    terminals,
    splitTerminalId,
    activeTerminalId,
    // The auto-Claude claim dies with its holder so the tab's next new
    // terminal can claim it again ("first" mode regains a session).
    claudeAutoId: tt.claudeAutoId === id ? null : tt.claudeAutoId,
  };
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
  mainTabOrder: [],
  splits: [],
  current: null,
  mainPrimary: "terminal",
  mainSecondary: null,

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
  tabRenames: {},
  openProjectsAsTabs: true,
  showRunningProcessNotice: true,

  // app-global
  modal: null,
  sidebarVisible: true,
  sidebarPosition: "left",
  theme: "dark",
  clipboardClearSeconds: 30,
  quota: null,
  setQuota: (q) => set({ quota: q }),
  quotaMeterEnabled: false,
  setQuotaMeterEnabled: (v) => set({ quotaMeterEnabled: v }),
  anthropicStatus: null,
  setAnthropicStatus: (s) => set({ anthropicStatus: s }),
  update: null,
  setUpdate: (s) => set({ update: s }),
  updateProgress: { phase: "idle" },
  setUpdateProgress: (p) => set({ updateProgress: p }),
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
  activeView: "files",
  claudeAutoStart: "first",
  defaultTerminal: "airlock",
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
        // surfacing a project hides any shown IDE page (its tab stays open)
        appPage: null,
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
        appPage: null,
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
      // tabTerminals[id] is intentionally NOT reset -- the blank tab's
      // terminal(s) survive the attach. So the fresh ProjectState must keep
      // those survivors in mainTabOrder (and focus the active one), or they'd be
      // missing from the tab order -- which breaks split adjacency (splitItems
      // only reorders tabs that are in mainTabOrder) and the unified tab bar.
      const tt = s.tabTerminals[id];
      const cur = s.tabState[id] ?? freshProjectState(null);
      const survivors = tt?.terminals ?? [];
      const activeId = tt?.activeTerminalId ?? survivors[0]?.id ?? null;
      const state: ProjectState = {
        ...freshProjectState(root),
        mainTabOrder: survivors.map((t) => ({
          kind: "terminal" as const,
          id: t.id,
        })),
        // Preserve the blank tab's terminal SPLIT scene: its terminals survive the
        // attach (tabTerminals[id] is kept), so the split pairing and the focused
        // pane must survive too -- otherwise the second split pane vanishes. A
        // blank tab has no folder, so the scene is terminal-only (no editor pane
        // can dangle). (audit PB-H8)
        splits: cur.splits,
        current:
          cur.current ?? (activeId ? { kind: "terminal", id: activeId } : null),
      };
      return {
        tabs: s.tabs.map((t) => (t.id === id ? { id, root } : t)),
        tabState: { ...s.tabState, [id]: state },
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
        // Replacing the active tab's whole project must dissolve a tab-level split
        // it belonged to -- otherwise the pair keeps referencing this tab and a
        // stale split lingers (closeTab dissolves a member the same way). (PB-H9)
        split:
          s.split && (s.split.a === id || s.split.b === id) ? null : s.split,
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
      // Re-clicking the active tab still surfaces it from under an IDE page.
      if (id === s.activeTabId)
        return s.appPage === null ? {} : { appPage: null };
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
        appPage: null, // selecting a project hides any shown IDE page
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
      const tabRenames = { ...s.tabRenames };
      delete tabRenames[id];
      // Closing either member dissolves the split; the OTHER member stays a
      // normal tab. otherId is the survivor, promoted when the closed tab was
      // the focused one (so the survivor becomes the single view).
      const pair = s.split;
      const split = pair && (pair.a === id || pair.b === id) ? null : pair;
      const otherId =
        pair && pair.a === id ? pair.b : pair && pair.b === id ? pair.a : null;

      if (id !== s.activeTabId) {
        // Closing a background tab: active stays put, mirror unchanged.
        return { tabs, tabState, tabTerminals, tabGlow, tabRenames, split };
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
          tabRenames,
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
        tabRenames: {},
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
  // Display-only tab label; the folder on disk is never touched (no IPC).
  // Empty/whitespace name clears the entry, reverting to the basename label.
  // Unknown id (tab closed mid-edit) -> no-op.
  renameTab: (tabId, name) => {
    set((s) => {
      if (!s.tabs.some((t) => t.id === tabId)) return {};
      const trimmed = name.trim();
      const tabRenames = { ...s.tabRenames };
      if (trimmed === "") delete tabRenames[tabId];
      else tabRenames[tabId] = trimmed;
      return { tabRenames };
    });
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
  openFile: (relPath, _file, tabId) =>
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
      // Show the opened file (it becomes `current`). If it is in a split that
      // split is shown; otherwise it shows alone. Other splits are untouched.
      // The pane loads its content on demand, so the `file` arg is unused here.
      return setView(
        s,
        tid,
        cur.splits,
        { kind: "file", path: relPath },
        {
          editorTabs,
          mainTabOrder,
          diff: null,
          settingsOpen: false,
          dbView: null,
        },
      );
    }),
  closeEditorTab: (relPath, tabId) =>
    set((s) => {
      const tid = tabId ?? s.activeTabId;
      const cur = s.tabState[tid];
      if (!cur) return {};
      const closed: PaneItem = { kind: "file", path: relPath };
      const editorTabs = cur.editorTabs.filter((p) => p !== relPath);
      const mainTabOrder = cur.mainTabOrder.filter(
        (it) => !samePaneItem(it, closed),
      );
      // The closed file's split partner (if any), for fallback focus.
      const pair = cur.splits.find(
        (p) => samePaneItem(p[0], closed) || samePaneItem(p[1], closed),
      );
      const partner = pair
        ? samePaneItem(pair[0], closed)
          ? pair[1]
          : pair[0]
        : null;
      const splits = dropFromSplits(cur.splits, closed);
      // If the closed file was focused, fall back to its split partner, else the
      // first remaining tab, else nothing. (The caller may have already moved
      // focus to a neighbor, in which case current is left as-is.)
      const current =
        cur.current && samePaneItem(cur.current, closed)
          ? (partner ?? mainTabOrder[0] ?? null)
          : cur.current;
      return setView(s, tid, splits, current, { editorTabs, mainTabOrder });
    }),
  renameFilePath: (fromRel, toRel, tabId) =>
    set((s) => {
      const tid = tabId ?? s.activeTabId;
      const cur = s.tabState[tid];
      if (!cur) return {};
      // Rebase a file path: exact match -> toRel; under fromRel/ -> toRel + rest.
      const rebase = (p: string): string =>
        p === fromRel
          ? toRel
          : p.startsWith(`${fromRel}/`)
            ? toRel + p.slice(fromRel.length)
            : p;
      const mapItem = (it: PaneItem): PaneItem =>
        it.kind === "file" ? { kind: "file", path: rebase(it.path) } : it;
      const editorTabs = cur.editorTabs.map(rebase);
      const mainTabOrder = cur.mainTabOrder.map(mapItem);
      const splits = cur.splits.map(
        (pair) => [mapItem(pair[0]), mapItem(pair[1])] as [PaneItem, PaneItem],
      );
      const current = cur.current ? mapItem(cur.current) : null;
      return setView(s, tid, splits, current, { editorTabs, mainTabOrder });
    }),
  viewItem: (item, tabId) =>
    set((s) => {
      const tid = tabId ?? s.activeTabId;
      const cur = s.tabState[tid];
      if (!cur) return {};
      // Focus `item`: shows its split (if in one) or itself alone. Other splits
      // are untouched. Showing a pane dismisses any overlay.
      return setView(s, tid, cur.splits, item, {
        diff: null,
        settingsOpen: false,
        dbView: null,
      });
    }),
  splitItems: (a, b, tabId) =>
    set((s) => {
      const tid = tabId ?? s.activeTabId;
      const cur = s.tabState[tid];
      if (!cur) return {};
      // Pull a and b out of any prior pair, add [a,b] as a NEW coexisting split,
      // and focus it. Place b's tab right after a's so the pair is adjacent.
      const splits: [PaneItem, PaneItem][] = [
        ...dropFromSplits(dropFromSplits(cur.splits, a), b),
        [a, b],
      ];
      // Place b's tab immediately after a's so the pair is adjacent. Self-heal
      // if a is somehow not in the order yet (e.g. a terminal that survived a
      // folder-attach): append a, then insert b after it -- so the pair is
      // always adjacent regardless of how it got here.
      const base = cur.mainTabOrder.some((it) => samePaneItem(it, a))
        ? cur.mainTabOrder
        : [...cur.mainTabOrder, a];
      const without = base.filter((it) => !samePaneItem(it, b));
      const ai = without.findIndex((it) => samePaneItem(it, a));
      const mainTabOrder =
        ai >= 0
          ? [...without.slice(0, ai + 1), b, ...without.slice(ai + 1)]
          : [...without, a, b];
      return setView(s, tid, splits, a, {
        mainTabOrder,
        diff: null,
        settingsOpen: false,
        dbView: null,
      });
    }),
  unsplitCurrent: (tabId) =>
    set((s) => {
      const tid = tabId ?? s.activeTabId;
      const cur = s.tabState[tid];
      if (!cur?.current) return {};
      // Break only the split the focused tab is in; keep it focused (now alone).
      return setView(
        s,
        tid,
        dropFromSplits(cur.splits, cur.current),
        cur.current,
      );
    }),
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
      const nextTT = { ...tt, terminals: [...tt.terminals, entry] };
      const sWithTT: AppState = {
        ...s,
        tabTerminals: { ...s.tabTerminals, [tid]: nextTT },
      };
      const cur = s.tabState[tid];
      if (!cur) return { tabTerminals: sWithTT.tabTerminals };
      // Append the new terminal at the far-right end of the tab order, and SHOW
      // it (it becomes `current`). Other splits are untouched; if the new
      // terminal is not in a split it shows alone. deriveView sets activeTerminalId.
      const mainTabOrder: PaneItem[] = [
        ...cur.mainTabOrder,
        { kind: "terminal", id: entry.id },
      ];
      return setView(
        sWithTT,
        tid,
        cur.splits,
        { kind: "terminal", id: entry.id },
        { mainTabOrder, diff: null, settingsOpen: false, dbView: null },
      );
    });
    return entry.id;
  },
  removeTerminal: (id) =>
    set((s) => {
      const tabId = findOwningTabId(s.tabTerminals, id);
      if (tabId === null) return {};
      const tt = s.tabTerminals[tabId];
      if (!tt) return {};
      const sAfterKill: AppState = {
        ...s,
        tabTerminals: { ...s.tabTerminals, [tabId]: removeFromTab(tt, id) },
      };
      const cur = s.tabState[tabId];
      if (!cur) return { tabTerminals: sAfterKill.tabTerminals };
      const killed: PaneItem = { kind: "terminal", id };
      const mainTabOrder = cur.mainTabOrder.filter(
        (it) => !samePaneItem(it, killed),
      );
      const pair = cur.splits.find(
        (p) => samePaneItem(p[0], killed) || samePaneItem(p[1], killed),
      );
      const partner = pair
        ? samePaneItem(pair[0], killed)
          ? pair[1]
          : pair[0]
        : null;
      const splits = dropFromSplits(cur.splits, killed);
      // If the killed terminal was focused, fall back to its split partner, else
      // the first remaining tab, else nothing (a respawn effect handles empty).
      const current =
        cur.current && samePaneItem(cur.current, killed)
          ? (partner ?? mainTabOrder[0] ?? null)
          : cur.current;
      return setView(sAfterKill, tabId, splits, current, { mainTabOrder });
    }),
  setActiveTerminal: (id, tabId) =>
    set((s) => {
      const tid = tabId ?? s.activeTabId;
      const cur = s.tabState[tid];
      if (!cur) return {};
      // Focusing a terminal = viewing it (shows its split if in one, else alone).
      return setView(s, tid, cur.splits, { kind: "terminal", id });
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

  claudeAutoDecision: (terminalId) => {
    let granted = false;
    set((s) => {
      const mode = s.claudeAutoStart;
      if (mode === "off") return {};
      const tabId = findOwningTabId(s.tabTerminals, terminalId);
      if (tabId === null) return {};
      if ((s.tabState[tabId]?.root ?? null) === null) return {}; // blank tab
      if (mode === "every") {
        granted = true;
        return {};
      }
      const tt = s.tabTerminals[tabId];
      if (!tt) return {};
      if (tt.claudeAutoId !== null && tt.claudeAutoId !== terminalId) return {}; // another terminal already holds the claim
      granted = true;
      if (tt.claudeAutoId === terminalId) return {}; // already ours
      return {
        tabTerminals: {
          ...s.tabTerminals,
          [tabId]: { ...tt, claudeAutoId: terminalId },
        },
      };
    });
    return granted;
  },

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
  setActiveView: (activeView) => set({ activeView }),
  setClaudeAutoStart: (claudeAutoStart) => set({ claudeAutoStart }),
  setDefaultTerminal: (defaultTerminal) => set({ defaultTerminal }),
  // Launch the external terminal for tabId's project root (no-op if no root).
  openExternalTerminal: (tabId) => {
    const root = useApp.getState().tabState[tabId]?.root ?? null;
    if (root) void window.airlock.openExternalTerminal(root);
  },
  // Settings is an OVERLAY: opening it clears the other overlays (diff/dbView)
  // but NOT the editor (selectedFile/editorTabs), so closing it restores the
  // editor/terminal underneath. Closing leaves the rest untouched.
  // Compat shim: callers (gear menu, Cmd-comma, close-editor, agent) now
  // drive the IDE-level Settings page-tab; the per-tab ProjectState
  // settingsOpen field is retired (stays false everywhere).
  setSettingsOpen: (v, _tabId) =>
    set((s) => ({
      appPage: v ? "settings" : s.appPage === "settings" ? null : s.appPage,
      settingsTabOpen: v,
    })),
  // Browsing a DB table is an overlay too: clears diff/settings (one overlay at
  // a time) but keeps the editor underneath. Passing null closes the data grid.
  setDbView: (v, tabId) =>
    set((s) => ({
      ...patchTab(s, tabId ?? s.activeTabId, {
        dbView: v,
        ...(v ? { diff: null, settingsOpen: false } : {}),
      }),
      // Browsing data surfaces the project: hide any shown IDE page.
      ...(v ? { appPage: null } : {}),
    })),
  setLayoutHydrated: (v) => set({ layoutHydrated: v }),
  fsVersion: {},
  newFileRequest: null,
  // Bump the freshness counter for a root so FileTrees on it re-list. Driven by
  // the main-process fs:changed watcher (see useFsWatch).
  bumpFsVersion: (root) =>
    set((s) => ({
      fsVersion: { ...s.fsVersion, [root]: (s.fsVersion[root] ?? 0) + 1 },
    })),
  palette: null,
  openPalette: (mode) => set({ palette: { mode } }),
  closePalette: () => set({ palette: null }),
  searchOpen: false,
  appPage: null,
  settingsTabOpen: false,
  usageTabOpen: false,
  openAppPage: (p) =>
    set((s) => ({
      appPage: p,
      settingsTabOpen: p === "settings" ? true : s.settingsTabOpen,
      usageTabOpen: p === "usage" ? true : s.usageTabOpen,
    })),
  showAppPage: (p) => set({ appPage: p }),
  closeAppPage: (p) =>
    set((s) => ({
      appPage: s.appPage === p ? null : s.appPage,
      settingsTabOpen: p === "settings" ? false : s.settingsTabOpen,
      usageTabOpen: p === "usage" ? false : s.usageTabOpen,
    })),
  search: null,
  setSearchOpen: (v) => set({ searchOpen: v }),
  setSearchResults: (query, results) => set({ search: { query, results } }),
  references: null,
  setReferences: (symbol, results) => set({ references: { symbol, results } }),
  closeReferences: () => set({ references: null }),
  reveal: null,
  revealLine: (tabId, path, line) =>
    set((s) => ({
      reveal: { tabId, path, line, nonce: (s.reveal?.nonce ?? 0) + 1 },
    })),
  fileOrder: {},
  // Pull a root's saved order map into the store. Idempotent -- a re-load just
  // refreshes it. Triggered by a FileTree effect on root change (a later task).
  loadFileOrder: async (root) => {
    try {
      const map = await window.airlock.getFileOrder(root);
      set((s) => ({ fileOrder: { ...s.fileOrder, [root]: map } }));
    } catch (err) {
      console.error("loadFileOrder failed", err);
    }
  },
  // Optimistically set one folder's order, then persist. On an IPC failure roll
  // back to the previous order so the view matches what is on disk.
  setFolderOrder: async (root, folderRel, names) => {
    const prev = useApp.getState().fileOrder[root]?.[folderRel];
    set((s) => {
      const forRoot = { ...(s.fileOrder[root] ?? {}) };
      if (names.length === 0) delete forRoot[folderRel];
      else forRoot[folderRel] = names;
      return { fileOrder: { ...s.fileOrder, [root]: forRoot } };
    });
    try {
      await window.airlock.setFileOrder(root, folderRel, names);
    } catch (err) {
      console.error("setFolderOrder failed", err);
      set((s) => {
        const forRoot = { ...(s.fileOrder[root] ?? {}) };
        if (prev === undefined) delete forRoot[folderRel];
        else forRoot[folderRel] = prev;
        return { fileOrder: { ...s.fileOrder, [root]: forRoot } };
      });
    }
  },
  requestNewFile: (tabId, kind) => set({ newFileRequest: { tabId, kind } }),
  clearNewFileRequest: () => set({ newFileRequest: null }),
}));
