import type { Completion } from "@codemirror/autocomplete";
import type { LspCompletionItem } from "../../../shared/ipc";

// LSP CompletionItemKind -> CodeMirror completion `type` (drives the icon).
const KIND: Record<number, NonNullable<Completion["type"]>> = {
  2: "method",
  3: "function",
  4: "function",
  5: "property",
  6: "variable",
  7: "class",
  8: "interface",
  9: "namespace",
  10: "property",
  13: "enum",
  14: "keyword",
  21: "constant",
};

export function toCmCompletions(items: LspCompletionItem[]): Completion[] {
  return items.map((it) => ({
    label: it.label,
    type: it.kind !== undefined ? (KIND[it.kind] ?? "variable") : undefined,
    detail: it.detail,
    info: it.documentation,
    apply: it.insertText ?? it.label,
  }));
}
