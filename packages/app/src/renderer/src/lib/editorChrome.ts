import { syntaxTree } from "@codemirror/language";
import type { Extension, Range } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  type EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { indentationMarkers } from "@replit/codemirror-indentation-markers";
import { showMinimap } from "@replit/codemirror-minimap";

// Nesting depth -> a stable bracket-color class, cycling every 6 levels (VS Code
// uses a small repeating palette). Negative depth (an unbalanced closer) clamps
// to 0. Pure, unit-tested.
export function bracketDepthClass(depth: number): string {
  const d = Math.max(0, depth) % 6; // clamp negative (unbalanced) depth to 0
  return `cm-bracket-depth-${d}`;
}

const BRACKETS: Record<string, "open" | "close"> = {
  "(": "open",
  "[": "open",
  "{": "open",
  ")": "close",
  "]": "close",
  "}": "close",
};

// Color brackets by nesting depth across the visible ranges. basicSetup's
// bracketMatching (cursor-pair highlight) is separate and unaffected.
const bracketColors = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = this.compute(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || u.selectionSet)
        this.decorations = this.compute(u.view);
    }
    compute(view: EditorView): DecorationSet {
      const marks: Range<Decoration>[] = [];
      let depth = 0;
      for (const { from, to } of view.visibleRanges) {
        const tree = syntaxTree(view.state);
        tree.iterate({
          from,
          to,
          enter: (node) => {
            if (node.to - node.from !== 1) return;
            const ch = view.state.sliceDoc(node.from, node.to);
            const kind = BRACKETS[ch];
            if (!kind) return;
            let d: number;
            if (kind === "open") {
              d = depth;
              depth += 1;
            } else {
              depth = Math.max(0, depth - 1);
              d = depth;
            }
            marks.push(
              Decoration.mark({ class: bracketDepthClass(d) }).range(
                node.from,
                node.to,
              ),
            );
          },
        });
      }
      marks.sort((a, b) => a.from - b.from);
      return Decoration.set(marks, true);
    }
  },
  { decorations: (v) => v.decorations },
);

// The VS Code visual chrome: minimap (right-side overview), indent guides, and
// bracket-pair colorization. Thin wiring around vetted community extensions plus
// our bracket colorizer; verified live, not unit-tested (except bracketDepthClass).
export function editorChrome(): Extension[] {
  return [
    showMinimap.compute([], () => ({
      create: () => {
        const dom = document.createElement("div");
        return { dom };
      },
      displayText: "blocks",
      showOverlay: "always",
    })),
    indentationMarkers({ highlightActiveBlock: true }),
    bracketColors,
  ];
}
