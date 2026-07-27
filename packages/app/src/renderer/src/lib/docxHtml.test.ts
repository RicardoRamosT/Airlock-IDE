// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { docxHtmlToReact, isDocxPath } from "./docxHtml";

// Render the React output back to a string so the assertions describe what a
// reader actually ends up with.
const out = (html: string) =>
  renderToStaticMarkup(docxHtmlToReact(html) as React.ReactNode);

describe("isDocxPath", () => {
  it("claims .docx, case-insensitively", () => {
    expect(isDocxPath("notes/Spec.DOCX")).toBe(true);
    expect(isDocxPath("a.docx")).toBe(true);
  });
  it("does NOT claim .doc -- mammoth cannot read the old binary format", () => {
    expect(isDocxPath("old.doc")).toBe(false);
    expect(isDocxPath("README")).toBe(false);
    expect(isDocxPath("a.docx.zip")).toBe(false);
  });
});

describe("docxHtmlToReact", () => {
  it("keeps the structure that makes a document readable", () => {
    expect(out("<h1>Title</h1><p>Body <strong>bold</strong></p>")).toBe(
      "<h1>Title</h1><p>Body <strong>bold</strong></p>",
    );
    expect(out("<ul><li>one</li><li>two</li></ul>")).toBe(
      "<ul><li>one</li><li>two</li></ul>",
    );
    // Mammoth emits rows straight under <table>, which React would reject as
    // invalid nesting -- but DOMParser inserts the implied tbody while parsing,
    // so the walk never sees a bare row. Pinned because the fix would
    // otherwise look missing.
    expect(out("<table><tr><td>a</td><td>b</td></tr></table>")).toBe(
      "<table><tbody><tr><td>a</td><td>b</td></tr></tbody></table>",
    );
    // ...but a document that already has one does not get a second.
    expect(out("<table><tbody><tr><td>a</td></tr></tbody></table>")).toBe(
      "<table><tbody><tr><td>a</td></tr></tbody></table>",
    );
  });

  // The whole reason this walks the DOM instead of setting innerHTML.
  it("cannot be used to inject script or event handlers", () => {
    const evil =
      '<p onclick="steal()">hi</p><script>steal()</script>' +
      '<iframe src="http://evil"></iframe><p>after</p>';
    const html = out(evil);
    expect(html).not.toContain("script");
    expect(html).not.toContain("onclick");
    expect(html).not.toContain("iframe");
    // ...while the document's actual prose survives.
    expect(html).toContain("hi");
    expect(html).toContain("after");
  });

  it("keeps inline images but drops ones that would hit the network", () => {
    expect(out('<p><img src="data:image/png;base64,AAA" alt="x"/></p>')).toBe(
      '<p><img src="data:image/png;base64,AAA" alt="x"/></p>',
    );
    expect(out('<p><img src="http://evil/pixel.gif"/></p>')).toBe("<p></p>");
  });

  it("renders links as text with the destination visible", () => {
    expect(out('<p><a href="http://x.com/a">click</a></p>')).toBe(
      "<p>click (http://x.com/a)</p>",
    );
  });

  it("keeps the text of an element it does not recognise", () => {
    expect(out("<section><p>kept</p></section>")).toBe("<p>kept</p>");
  });
});
