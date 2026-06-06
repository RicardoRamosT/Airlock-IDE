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

// Reserved tab id for the implicit "no project open" terminal. The store's
// `tabs`/`activeTabId` stay null-when-no-project (per the design), but terminals
// must still render with no folder open (today's behavior: one shell exists even
// without a project). The renderer mounts a ProjectTerminals under this id only
// while `activeTabId === null`; its state lives in `tabTerminals` keyed here.
export const IMPLICIT_TAB_ID = "__implicit__";

let projCounter = 0;
const newTabId = (): string => `proj-${++projCounter}`;

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
  tabs: { id: string; root: string }[]; // tab order; root is never null here
  activeTabId: string | null; // null = no project open (implicit terminal tab)
  tabSnapshots: Record<string, Snapshot>; // parked non-terminal state of INACTIVE tabs
  tabTerminals: Record<string, TabTerminals>; // per-tab terminals (active + inactive all mounted)
  openProjectsAsTabs: boolean; // app-global (persisted); used by later tasks

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

  // --- Tab actions ---
  openProject: (root: string) => void;
  switchTab: (id: string) => void;
  closeTab: (id: string) => void;
  setOpenProjectsAsTabs: (v: boolean) => void;

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
// Falls back to scanning the implicit tab too.
const findOwningTabId = (
  tabTerminals: Record<string, TabTerminals>,
  terminalId: string,
): string | null => {
  for (const [tabId, tt] of Object.entries(tabTerminals)) {
    if (tt.terminals.some((t) => t.id === terminalId)) return tabId;
  }
  return null;
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

  // tab model — start with NO project (implicit terminal tab handles the
  // no-folder state in the renderer). The implicit tab's terminal state must
  // exist so a default shell can spawn before any folder is opened.
  tabs: [],
  activeTabId: null,
  tabSnapshots: {},
  tabTerminals: { [IMPLICIT_TAB_ID]: emptyTabTerminals() },
  openProjectsAsTabs: true,

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

  // --- Tab actions ---
  openProject: (root) =>
    set((s) => {
      const id = newTabId();
      // Park the outgoing active tab's live non-terminal state.
      const tabSnapshots =
        s.activeTabId !== null
          ? { ...s.tabSnapshots, [s.activeTabId]: snapshotActive(s) }
          : s.tabSnapshots;
      const tabTerminals = { ...s.tabTerminals, [id]: emptyTabTerminals() };
      // Opening the FIRST project from the no-project state retires the implicit
      // scratch tab: its ProjectTerminals unmounts (pane cleanup kills the
      // scratch pty) and we drop its leftover entry so returning to no-project
      // later starts clean with a single fresh shell.
      if (s.activeTabId === null)
        tabTerminals[IMPLICIT_TAB_ID] = emptyTabTerminals();
      return {
        tabs: [...s.tabs, { id, root }],
        activeTabId: id,
        tabSnapshots,
        tabTerminals,
        // fresh top-level per-project state for the new tab
        ...loadSnapshot(root, freshSnapshot()),
        // a freshly opened project starts with no modal carried over
        modal: null,
      };
    }),
  switchTab: (id) =>
    set((s) => {
      if (id === s.activeTabId) return {};
      const target = s.tabs.find((t) => t.id === id);
      if (!target) return {}; // unknown id -> no-op
      // Park current active tab's live state, load the target's snapshot.
      const tabSnapshots =
        s.activeTabId !== null
          ? { ...s.tabSnapshots, [s.activeTabId]: snapshotActive(s) }
          : s.tabSnapshots;
      const snap = tabSnapshots[id] ?? freshSnapshot();
      return {
        activeTabId: id,
        tabSnapshots,
        ...loadSnapshot(target.root, snap),
      };
    }),
  closeTab: (id) =>
    set((s) => {
      const idx = s.tabs.findIndex((t) => t.id === id);
      if (idx === -1) return {}; // unknown id (e.g. implicit) -> no-op
      const tabs = s.tabs.filter((t) => t.id !== id);
      // Removing the tab's terminal state unmounts its panes -> its ptys die.
      const tabTerminals = { ...s.tabTerminals };
      delete tabTerminals[id];
      const tabSnapshots = { ...s.tabSnapshots };
      delete tabSnapshots[id];

      if (id !== s.activeTabId) {
        // Closing a background tab: active stays put, top-level unchanged.
        return { tabs, tabTerminals, tabSnapshots };
      }

      // Closing the active tab: promote a neighbor (prefer the previous tab,
      // else the next), or fall back to the no-project state if none remain.
      const neighbor = tabs[idx - 1] ?? tabs[idx] ?? null;
      if (neighbor) {
        const snap = tabSnapshots[neighbor.id] ?? freshSnapshot();
        return {
          tabs,
          tabTerminals,
          tabSnapshots,
          activeTabId: neighbor.id,
          ...loadSnapshot(neighbor.root, snap),
        };
      }
      // No tabs left -> no-project state. Reset the implicit terminal tab to
      // empty so the renderer mounts exactly one fresh scratch shell (matching
      // the launch state), not whatever was left from before any project.
      return {
        tabs,
        tabSnapshots,
        tabTerminals: {
          ...tabTerminals,
          [IMPLICIT_TAB_ID]: emptyTabTerminals(),
        },
        activeTabId: null,
        ...loadSnapshot(null, freshSnapshot()),
        modal: null,
      };
    }),
  setOpenProjectsAsTabs: (openProjectsAsTabs) => set({ openProjectsAsTabs }),

  // Thin adapter so existing callers (Sidebar / useMenuActions) keep working:
  // a string root opens a project tab; null closes the active tab (or no-ops if
  // already in the no-project state). Delegates to the tab actions directly
  // (each performs its own set) rather than nesting set() calls.
  setRoot: (root) => {
    const s = useApp.getState();
    if (typeof root === "string") {
      s.openProject(root);
      return;
    }
    if (s.activeTabId !== null) s.closeTab(s.activeTabId);
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

  // --- Terminal setters ---
  addTerminal: () => {
    const entry = newEntry();
    set((s) => {
      const tabId = s.activeTabId ?? IMPLICIT_TAB_ID;
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
      const tabId = s.activeTabId ?? IMPLICIT_TAB_ID;
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
      const tabId = s.activeTabId ?? IMPLICIT_TAB_ID;
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
