// markdownHeadings.ts
// A rehype plugin that gives each heading in the markdown preview an id, so
// `[Install](#install)` and a sibling file's `other.md#install` can scroll.
//
// PREFIXED because the preview lives in the app's own DOM: a README heading
// called "Root" would otherwise get id="root" -- React's mount node -- and
// `getElementById` would find the wrong element. GitHub prefixes for the same
// reason ("user-content-"); links still use the bare slug, and the click
// handler adds the prefix.
import { headingSlug } from "./markdownLinks";

export const HEADING_ID_PREFIX = "md-";

// Minimal hast shape -- enough to walk; avoids depending on @types/hast, which
// is only a transitive dependency here.
interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

const HEADING = /^h[1-6]$/;

function textOf(n: HastNode): string {
  if (n.type === "text") return n.value ?? "";
  return (n.children ?? []).map(textOf).join("");
}

export function rehypeHeadingIds() {
  return (tree: HastNode): void => {
    const seen = new Map<string, number>();
    const walk = (n: HastNode): void => {
      if (n.type === "element" && n.tagName && HEADING.test(n.tagName)) {
        const base = headingSlug(textOf(n));
        const count = seen.get(base) ?? 0;
        seen.set(base, count + 1);
        const slug = count === 0 ? base : `${base}-${count}`;
        n.properties = { ...n.properties, id: `${HEADING_ID_PREFIX}${slug}` };
      }
      for (const c of n.children ?? []) walk(c);
    };
    walk(tree);
  };
}
