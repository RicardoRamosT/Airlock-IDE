// overviewMarkdown.test.ts
import { describe, expect, it } from "vitest";
import { parseOverviewMarkdown } from "./overviewMarkdown";

describe("parseOverviewMarkdown", () => {
  it("parses headings with their level", () => {
    expect(parseOverviewMarkdown("## Areas")).toEqual([
      { t: "heading", level: 2, spans: [{ t: "text", v: "Areas" }] },
    ]);
  });
  it("parses an unordered list", () => {
    const b = parseOverviewMarkdown("- one\n- two");
    expect(b).toEqual([
      {
        t: "list",
        ordered: false,
        items: [
          { spans: [{ t: "text", v: "one" }], sub: null },
          { spans: [{ t: "text", v: "two" }], sub: null },
        ],
      },
    ]);
  });
  it("parses inline strong, em, code", () => {
    expect(parseOverviewMarkdown("a **b** _c_ `d`")).toEqual([
      {
        t: "paragraph",
        spans: [
          { t: "text", v: "a " },
          { t: "strong", v: "b" },
          { t: "text", v: " " },
          { t: "em", v: "c" },
          { t: "text", v: " " },
          { t: "code", v: "d" },
        ],
      },
    ]);
  });
  it("keeps a relative-path link", () => {
    expect(
      parseOverviewMarkdown("[main](packages/app/src/main/index.ts)"),
    ).toEqual([
      {
        t: "paragraph",
        spans: [
          { t: "link", href: "packages/app/src/main/index.ts", text: "main" },
        ],
      },
    ]);
  });
  it("drops a javascript: link but keeps its text", () => {
    expect(parseOverviewMarkdown("[x](javascript:alert(1))")).toEqual([
      { t: "paragraph", spans: [{ t: "text", v: "x" }] },
    ]);
  });
  it("drops a data: link but keeps its text", () => {
    expect(parseOverviewMarkdown("[x](data:text/html,<h1>)")).toEqual([
      { t: "paragraph", spans: [{ t: "text", v: "x" }] },
    ]);
  });
  it("keeps an https:// link", () => {
    expect(parseOverviewMarkdown("[site](https://example.com)")).toEqual([
      {
        t: "paragraph",
        spans: [{ t: "link", href: "https://example.com", text: "site" }],
      },
    ]);
  });
  it("parses a fenced code block", () => {
    expect(parseOverviewMarkdown("```ts\nconst x = 1\n```")).toEqual([
      { t: "code", lang: "ts", v: "const x = 1" },
    ]);
  });

  // --- blockquote ---
  it("parses a blockquote into a quote block with joined inline spans", () => {
    const b = parseOverviewMarkdown("> This is\n> a quote");
    expect(b).toEqual([
      {
        t: "quote",
        spans: [{ t: "text", v: "This is a quote" }],
      },
    ]);
  });

  it("terminates a blockquote at a blank line", () => {
    const b = parseOverviewMarkdown("> line one\n\n> line two");
    expect(b).toHaveLength(2);
    expect(b[0]).toEqual({
      t: "quote",
      spans: [{ t: "text", v: "line one" }],
    });
    expect(b[1]).toEqual({
      t: "quote",
      spans: [{ t: "text", v: "line two" }],
    });
  });

  // --- GFM table ---
  it("parses a GFM table into a table block", () => {
    const md =
      "| Name | Role |\n| --- | --- |\n| Alice | Admin |\n| Bob | User |";
    const b = parseOverviewMarkdown(md);
    expect(b).toEqual([
      {
        t: "table",
        headers: [[{ t: "text", v: "Name" }], [{ t: "text", v: "Role" }]],
        rows: [
          [[{ t: "text", v: "Alice" }], [{ t: "text", v: "Admin" }]],
          [[{ t: "text", v: "Bob" }], [{ t: "text", v: "User" }]],
        ],
      },
    ]);
  });

  it("does NOT parse a pipe-containing line without a delimiter row as a table (stays paragraph)", () => {
    const md = "foo | bar | baz";
    const b = parseOverviewMarkdown(md);
    expect(b).toEqual([
      { t: "paragraph", spans: [{ t: "text", v: "foo | bar | baz" }] },
    ]);
  });

  // --- nested lists ---
  it("parses a nested unordered list", () => {
    const md = "- parent\n  - child one\n  - child two";
    const b = parseOverviewMarkdown(md);
    expect(b).toEqual([
      {
        t: "list",
        ordered: false,
        items: [
          {
            spans: [{ t: "text", v: "parent" }],
            sub: {
              ordered: false,
              items: [
                { spans: [{ t: "text", v: "child one" }], sub: null },
                { spans: [{ t: "text", v: "child two" }], sub: null },
              ],
            },
          },
        ],
      },
    ]);
  });
});
