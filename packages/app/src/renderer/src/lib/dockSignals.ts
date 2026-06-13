// Whether an AirLock overlay currently covers the terminal pane, so the docked
// external window must be hidden behind it. Pure (no store import) for testing.
export function overlayActive(s: {
  searchOpen: boolean;
  references: unknown | null;
  appPage: "settings" | "usage" | null;
}): boolean {
  return s.searchOpen || s.references !== null || s.appPage !== null;
}
