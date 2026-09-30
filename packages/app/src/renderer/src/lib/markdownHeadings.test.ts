import { describe, expect, it } from "vitest";
import { HEADING_ID_PREFIX, rehypeHeadingIds } from "./markdownHeadings";

type Node = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: Node[];
};

const h = (tag: string, ...children: Node[]): Node => ({
  type: "element",
  tagName: tag,
  properties: {},
  children,
});
const t = (value: string): Node => ({ type: "text", value });

function run(...children: Node[]): Node[] {
  const tree: Node = { type: "root", children };
  rehypeHeadingIds()(tree as never);
  return tree.children ?? [];
}

describe("rehypeHeadingIds", () => {
  it("gives every heading a prefixed GitHub slug of its text", () => {
    const [a, b] = run(h("h1", t("Trackview")), h("h2", t("Getting started")));
    expect(a?.properties?.id).toBe(`${HEADING_ID_PREFIX}trackview`);
    expect(b?.properties?.id).toBe(`${HEADING_ID_PREFIX}getting-started`);
  });

  it("reads text through inline markup", () => {
    const [a] = run(h("h2", t("Using "), h("code", t("gh")), t(" safely")));
    expect(a?.properties?.id).toBe(`${HEADING_ID_PREFIX}using-gh-safely`);
  });

  it("de-duplicates repeats the way GitHub does (-1, -2)", () => {
    const ids = run(
      h("h2", t("Notes")),
      h("h3", t("Notes")),
      h("h2", t("Notes")),
    ).map((n) => n.properties?.id);
    expect(ids).toEqual([
      `${HEADING_ID_PREFIX}notes`,
      `${HEADING_ID_PREFIX}notes-1`,
      `${HEADING_ID_PREFIX}notes-2`,
    ]);
  });

  it("leaves non-headings alone", () => {
    const [p] = run(h("p", t("Root")));
    expect(p?.properties?.id).toBeUndefined();
  });
});
