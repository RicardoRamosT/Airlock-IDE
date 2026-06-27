// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { OverviewMarkdown } from "./OverviewMarkdown";

afterEach(cleanup);

// The exact shape of AirLock's own README header — the case the user reported
// rendering as raw `<div align="center">` + garbled badge text.
const README_HEADER = [
  '<div align="center">',
  "",
  "# AirLock",
  "",
  "### The multi-project, Claude-first IDE that can't leak your secrets.",
  "",
  "[![Platform](https://img.shields.io/badge/platform-macOS%20(Apple%20Silicon)-black)](#install)",
  "[![License](https://img.shields.io/badge/license-source--available-blue)](LICENSE.md)",
  "[![Release](https://img.shields.io/badge/release-v0.4.0-orange)](../../releases)",
  "",
  '<img src="docs/assets/hero.png" alt="AirLock hero" width="800"/>',
  "",
  "</div>",
  "",
  "AirLock is a terminal-first IDE.",
].join("\n");

describe("OverviewMarkdown", () => {
  it("does not print raw HTML wrappers or garbled badge markup", () => {
    const { container } = render(<OverviewMarkdown md={README_HEADER} />);
    const text = container.textContent ?? "";
    expect(text).not.toContain('align="center"');
    expect(text).not.toContain("<div");
    expect(text).not.toContain("</div>");
    expect(text).not.toContain("<img");
    expect(text).not.toContain("!["); // no leaked image markup
    // The real content still renders.
    expect(text).toContain("AirLock");
    expect(text).toContain("terminal-first IDE");
  });

  it("renders remote badges as clean labelled links (alt text + href)", () => {
    const { container } = render(<OverviewMarkdown md={README_HEADER} />);
    const links = Array.from(container.querySelectorAll("a"));
    const byText = (t: string) => links.find((a) => a.textContent === t);
    expect(byText("Platform")?.getAttribute("href")).toBe("#install");
    expect(byText("License")?.getAttribute("href")).toBe("LICENSE.md");
    expect(byText("Release")?.getAttribute("href")).toBe("../../releases");
  });

  it("renders a loadable data: image as an <img>", () => {
    const { container } = render(
      <OverviewMarkdown md={"![dot](data:image/png;base64,AAAA)"} />,
    );
    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toBe("data:image/png;base64,AAAA");
    expect(img?.getAttribute("alt")).toBe("dot");
  });
});
