import type { Extension } from "@codemirror/state";
import { vscodeDark, vscodeLight } from "@uiw/codemirror-theme-vscode";

// VS Code Dark+ / Light+ colors for the editor, replacing the bluish-gray One
// Dark. Returned as a single Extension so it slots into EditorPane's theme
// Compartment exactly where oneDark/[] used to (PB-H1-safe: swapped in place,
// never a rebuild dependency).
export function editorTheme(theme: "dark" | "light"): Extension {
  return theme === "dark" ? vscodeDark : vscodeLight;
}
