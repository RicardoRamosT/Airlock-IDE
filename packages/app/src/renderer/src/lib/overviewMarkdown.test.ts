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

  // --- embedded HTML (inert) ---
  it("drops standalone HTML tag lines instead of printing them as text", () => {
    const md = '<div align="center">\n\n# AirLock\n\n</div>';
    expect(parseOverviewMarkdown(md)).toEqual([
      { t: "heading", level: 1, spans: [{ t: "text", v: "AirLock" }] },
    ]);
  });

  it("drops a standalone self-closing <img> HTML tag line", () => {
    const md = '<img src="docs/assets/hero.png" alt="hero" width="800"/>';
    expect(parseOverviewMarkdown(md)).toEqual([]);
  });

  it("does NOT mistake an autolink-style <https://…> line for an HTML tag", () => {
    // No autolink support, so it stays literal text — but it must NOT be dropped.
    expect(parseOverviewMarkdown("<https://example.com>")).toEqual([
      { t: "paragraph", spans: [{ t: "text", v: "<https://example.com>" }] },
    ]);
  });

  // --- images ---
  it("parses a standalone data: image", () => {
    expect(
      parseOverviewMarkdown("![logo](data:image/png;base64,AAAA)"),
    ).toEqual([
      {
        t: "paragraph",
        spans: [{ t: "image", src: "data:image/png;base64,AAAA", alt: "logo" }],
      },
    ]);
  });

  it("keeps a relative image path as an image", () => {
    expect(parseOverviewMarkdown("![hero](docs/assets/hero.png)")).toEqual([
      {
        t: "paragraph",
        spans: [{ t: "image", src: "docs/assets/hero.png", alt: "hero" }],
      },
    ]);
  });

  it("drops a javascript: image src but keeps its alt text", () => {
    expect(parseOverviewMarkdown("![x](javascript:alert(1))")).toEqual([
      { t: "paragraph", spans: [{ t: "text", v: "x" }] },
    ]);
  });

  // --- image-links (badges) ---
  it("parses a badge (image wrapped in a link) into an imageLink", () => {
    const md =
      "[![Platform](https://img.shields.io/badge/platform-macOS-black)](#install)";
    expect(parseOverviewMarkdown(md)).toEqual([
      {
        t: "paragraph",
        spans: [
          {
            t: "imageLink",
            href: "#install",
            src: "https://img.shields.io/badge/platform-macOS-black",
            alt: "Platform",
          },
        ],
      },
    ]);
  });

  it("parses an image-link whose src contains balanced parens", () => {
    const md =
      "[![Platform](https://img.shields.io/badge/platform-macOS%20(Apple%20Silicon)-black)](#install)";
    expect(parseOverviewMarkdown(md)).toEqual([
      {
        t: "paragraph",
        spans: [
          {
            t: "imageLink",
            href: "#install",
            src: "https://img.shields.io/badge/platform-macOS%20(Apple%20Silicon)-black",
            alt: "Platform",
          },
        ],
      },
    ]);
  });

  it("keeps a relative-path link in an image-link (e.g. badge -> LICENSE.md)", () => {
    const md =
      "[![License](https://img.shields.io/badge/license-x-blue)](LICENSE.md)";
    expect(parseOverviewMarkdown(md)).toEqual([
      {
        t: "paragraph",
        spans: [
          {
            t: "imageLink",
            href: "LICENSE.md",
            src: "https://img.shields.io/badge/license-x-blue",
            alt: "License",
          },
        ],
      },
    ]);
  });
});
