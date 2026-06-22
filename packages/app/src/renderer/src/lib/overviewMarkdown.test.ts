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
        items: [[{ t: "text", v: "one" }], [{ t: "text", v: "two" }]],
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
});
