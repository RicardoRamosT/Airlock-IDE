import { describe, expect, it } from "vitest";
import {
  headingSlug,
  isMarkdownPath,
  resolveMarkdownHref,
  resolveMarkdownImage,
  resolveRepoPath,
} from "./markdownLinks";

describe("isMarkdownPath", () => {
  it("claims .md and .markdown, any case", () => {
    expect(isMarkdownPath("README.md")).toBe(true);
    expect(isMarkdownPath("docs/Guide.MD")).toBe(true);
    expect(isMarkdownPath("notes.markdown")).toBe(true);
  });
  it("does not claim .mdx -- it embeds JSX, which would render as junk", () => {
    expect(isMarkdownPath("page.mdx")).toBe(false);
  });
  it("does not claim other files or extension-less names", () => {
    expect(isMarkdownPath("src/index.ts")).toBe(false);
    expect(isMarkdownPath("md")).toBe(false);
    expect(isMarkdownPath("docs.md/file.ts")).toBe(false);
  });
});

describe("resolveRepoPath", () => {
  it("resolves against the linking FILE's folder, not the project root", () => {
    expect(resolveRepoPath("docs/guide/intro.md", "setup.md")).toBe(
      "docs/guide/setup.md",
    );
    expect(resolveRepoPath("docs/guide/intro.md", "../api.md")).toBe(
      "docs/api.md",
    );
    expect(resolveRepoPath("README.md", "docs/deployment.md")).toBe(
      "docs/deployment.md",
    );
  });
  it("collapses ./ segments", () => {
    expect(resolveRepoPath("README.md", "./a/./b.ts")).toBe("a/b.ts");
  });
  it("treats a leading / as the PROJECT root, the way GitHub does", () => {
    expect(resolveRepoPath("docs/guide/intro.md", "/packages/x.ts")).toBe(
      "packages/x.ts",
    );
  });
  it("decodes percent-escapes so a spaced filename opens", () => {
    expect(resolveRepoPath("README.md", "docs/My%20Notes.md")).toBe(
      "docs/My Notes.md",
    );
  });
  it("refuses a path that escapes the project root", () => {
    expect(resolveRepoPath("README.md", "../secret.txt")).toBeNull();
    expect(resolveRepoPath("docs/a.md", "../../x")).toBeNull();
  });
  it("refuses malformed escapes and empty targets", () => {
    expect(resolveRepoPath("README.md", "%E0%A4%A")).toBeNull();
    expect(resolveRepoPath("README.md", "")).toBeNull();
    expect(resolveRepoPath("README.md", "./")).toBeNull();
  });
});

describe("resolveMarkdownHref", () => {
  it("sends http(s) to the browser", () => {
    expect(resolveMarkdownHref("README.md", "https://x.dev/a")).toEqual({
      kind: "external",
      url: "https://x.dev/a",
    });
  });
  it("leaves mailto: inert -- main's openExternal accepts http(s) only", () => {
    expect(resolveMarkdownHref("README.md", "mailto:a@b.c")).toBeNull();
  });
  it("opens an in-repo file, dropping the #fragment and ?query from the path", () => {
    expect(resolveMarkdownHref("docs/a.md", "b.md#install")).toEqual({
      kind: "file",
      path: "docs/b.md",
      anchor: "install",
    });
    expect(resolveMarkdownHref("docs/a.md", "b.md?raw=1")).toEqual({
      kind: "file",
      path: "docs/b.md",
      anchor: null,
    });
  });
  it("scrolls for a bare #anchor", () => {
    expect(resolveMarkdownHref("README.md", "#getting-started")).toEqual({
      kind: "anchor",
      id: "getting-started",
    });
  });
  it("neutralises every other scheme", () => {
    for (const bad of [
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      "data:text/html,<script>",
      "file:///etc/passwd",
      "vbscript:x",
    ])
      expect(resolveMarkdownHref("README.md", bad)).toBeNull();
  });
  it("refuses a link that escapes the project", () => {
    expect(resolveMarkdownHref("README.md", "../../etc/passwd")).toBeNull();
  });
});

describe("resolveMarkdownImage", () => {
  it("loads an in-repo image relative to the file", () => {
    expect(resolveMarkdownImage("docs/a.md", "img/shot.png")).toEqual({
      kind: "repo",
      path: "docs/img/shot.png",
    });
  });
  it("passes a data:image through (the CSP allows it)", () => {
    expect(resolveMarkdownImage("a.md", "data:image/png;base64,AAAA")).toEqual({
      kind: "data",
      src: "data:image/png;base64,AAAA",
    });
  });
  it("marks remote images, which the CSP blocks, so the alt text shows", () => {
    expect(
      resolveMarkdownImage("a.md", "https://img.shields.io/badge/x"),
    ).toEqual({ kind: "remote" });
  });
  it("refuses other schemes, a non-image data: URL, and escapes", () => {
    expect(resolveMarkdownImage("a.md", "javascript:x")).toBeNull();
    expect(resolveMarkdownImage("a.md", "data:text/html,x")).toBeNull();
    expect(resolveMarkdownImage("a.md", "../../x.png")).toBeNull();
  });
});

describe("headingSlug", () => {
  it("matches GitHub's anchors for ordinary headings", () => {
    expect(headingSlug("Getting started")).toBe("getting-started");
    expect(headingSlug("Using Trackview from Claude")).toBe(
      "using-trackview-from-claude",
    );
  });
  it("drops punctuation but keeps hyphens, underscores and digits", () => {
    expect(headingSlug("What's new in v0.6.1?")).toBe("whats-new-in-v061");
    expect(headingSlug("snake_case & kebab-case")).toBe(
      "snake_case--kebab-case",
    );
  });
  it("keeps non-ASCII letters (GitHub does)", () => {
    expect(headingSlug("Búsqueda rápida")).toBe("búsqueda-rápida");
  });
});
