import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

// A registry that maps a tabId -> the DOM element that should currently host
// that tab's terminals. ProjectPane mounts an empty <div> portal target and
// registers it under its tabId; TerminalManager (mounted ONCE at app root)
// portals each tab's <ProjectTerminals> INTO the registered element (or a
// hidden keep-alive div when a tab is not in a visible pane).
//
// The point is pty preservation: the <ProjectTerminals> React elements live in
// TerminalManager's stable tree and never unmount. Only their PORTAL TARGET
// changes when split toggles / focus swaps / tabs switch -- the DOM nodes move
// between containers without a React unmount, so no TerminalPane unmounts and
// no pty dies.
interface TerminalSlots {
  // Current target element for each tab (absent => fall back to keep-alive).
  slots: Record<string, HTMLElement | null>;
  // ProjectPane's ref callback registers its element on mount.
  register: (tabId: string, el: HTMLElement) => void;
  // Cleanup (the ref callback's returned fn) clears the entry, but only if it
  // still points at THIS element -- a fast remount can register the new
  // element before the old one's cleanup runs, so we must not wipe a newer
  // target.
  unregister: (tabId: string, el: HTMLElement) => void;
}

const TerminalSlotsContext = createContext<TerminalSlots | null>(null);

export function TerminalSlotsProvider({ children }: { children: ReactNode }) {
  const [slots, setSlots] = useState<Record<string, HTMLElement | null>>({});

  // STABLE identities (empty deps + the functional setSlots updater, so they
  // never close over `slots`). This is load-bearing: ProjectPane's slotRef
  // callback depends on these, and if they changed identity on every `slots`
  // update the ref would re-fire (cleanup -> unregister -> setSlots -> new
  // identities -> ...), an infinite update loop that blanks the whole app.
  const register = useCallback((tabId: string, el: HTMLElement) => {
    setSlots((prev) => (prev[tabId] === el ? prev : { ...prev, [tabId]: el }));
  }, []);
  const unregister = useCallback((tabId: string, el: HTMLElement) => {
    setSlots((prev) => {
      if (prev[tabId] !== el) return prev; // a newer target already won
      const next = { ...prev };
      delete next[tabId];
      return next;
    });
  }, []);

  const value = useMemo<TerminalSlots>(
    () => ({ slots, register, unregister }),
    [slots, register, unregister],
  );

  return (
    <TerminalSlotsContext.Provider value={value}>
      {children}
    </TerminalSlotsContext.Provider>
  );
}

// TerminalManager reads the whole registry to pick each tab's portal target.
export function useTerminalSlots(): TerminalSlots {
  const ctx = useContext(TerminalSlotsContext);
  if (!ctx) {
    throw new Error(
      "useTerminalSlots must be used within TerminalSlotsProvider",
    );
  }
  return ctx;
}
