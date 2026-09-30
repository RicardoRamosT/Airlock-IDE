// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { FileContent } from "../../../shared/ipc";
import { MarkdownFile, MarkdownPreview } from "./MarkdownPreview";

// The editor is its own heavily-tested component; here it only has to prove
// WHICH mode is showing.
vi.mock("./EditorPane", () => ({
  EditorPane: ({ relPath }: { relPath: string }) => (
    <div data-testid="editor">editing {relPath}</div>
  ),
}));

const file = (
  content: string,
  over: Partial<FileContent> = {},
): FileContent => ({
  content,
  truncated: false,
  binary: false,
  size: content.length,
  mtimeMs: 1,
  ...over,
});

let readFile: ReturnType<typeof vi.fn>;
let readImageDataUrl: ReturnType<typeof vi.fn>;
let hostOpenExternal: ReturnType<typeof vi.fn>;
let fsListeners: ((e: { root: string }) => void)[];

beforeEach(() => {
  fsListeners = [];
  readFile = vi.fn(async () => file("# fresh"));
  readImageDataUrl = vi.fn(async () => ({
    dataUrl: "data:image/png;base64,AAAA",
    tooLarge: false,
  }));
  hostOpenExternal = vi.fn(async () => undefined);
  (window as unknown as { airlock: Record<string, unknown> }).airlock = {
    readFile,
    readImageDataUrl,
    hostOpenExternal,
    onFsChanged: (cb: (e: { root: string }) => void) => {
      fsListeners.push(cb);
      return () => {
        fsListeners = fsListeners.filter((l) => l !== cb);
      };
    },
  };
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function preview(md: string, relPath = "README.md", onOpenFile = vi.fn()) {
  // The mount re-read finds the same text on disk unless a test says otherwise.
  readFile.mockImplementation(async () => file(md));
  const r = render(
    <MarkdownPreview
      root="/proj"
      relPath={relPath}
      file={file(md)}
      onOpenFile={onOpenFile}
    />,
  );
  return { ...r, onOpenFile };
}

// The README that prompted this (Trackview's), trimmed: it is the regression.
const TRACKVIEW = `# Trackview

Internal ticketing and sprint planning for ViewNear.

## Getting started

    cp .env.example .env
    npm install

| Port | Service |
| ---- | ------- |
| 5433 | Postgres |

- [x] migrations
- [ ] seed
`;

it("renders a real document: headings, indented code, tables, task lists", () => {
  const { container } = preview(TRACKVIEW);
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
    "Trackview",
  );
  expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(
    "Getting started",
  );
  // An INDENTED code block is a block, not one run-on paragraph -- the case
  // the in-house Overview parser could not handle.
  const pre = container.querySelector("pre");
  expect(pre?.textContent).toBe("cp .env.example .env\nnpm install\n");
  expect(screen.getByRole("table")).toBeTruthy();
  expect(screen.getByText("Postgres").tagName).toBe("TD");
  const boxes = container.querySelectorAll<HTMLInputElement>(
    'input[type="checkbox"]',
  );
  expect([...boxes].map((b) => b.checked)).toEqual([true, false]);
});

it("highlights a fenced block in a language the editor ships", () => {
  const { container } = preview("```ts\nconst a = 1;\n```\n");
  const kw = [...container.querySelectorAll("pre code span")].find(
    (s) => s.textContent === "const",
  );
  expect(kw?.className).toMatch(/tok-keyword/);
});

it("keeps raw HTML inert: no element is created from it", () => {
  const { container } = preview(
    '<div align="center">hi</div>\n\n<script>window.pwned=1</script>\n\n<img src=x onerror="window.pwned=1">\n\ntext <b>bold</b> after',
  );
  expect(container.querySelector("script")).toBeNull();
  expect(container.querySelector("img")).toBeNull();
  expect(container.querySelector("div[align]")).toBeNull();
  expect(container.querySelector("b")).toBeNull();
  expect((window as unknown as { pwned?: number }).pwned).toBeUndefined();
});

it("opens an http(s) link in the browser, through main's validated bridge", () => {
  preview("[site](https://example.com/x)");
  fireEvent.click(screen.getByText("site"));
  expect(hostOpenExternal).toHaveBeenCalledWith("https://example.com/x");
});

it("opens a relative link as a file, resolved against the linking file", () => {
  const { onOpenFile } = preview(
    "[api](../api.md#auth)",
    "docs/guide/intro.md",
  );
  fireEvent.click(screen.getByText("api"));
  expect(onOpenFile).toHaveBeenCalledWith("docs/api.md");
  expect(hostOpenExternal).not.toHaveBeenCalled();
});

it("makes an unsafe link do nothing at all", () => {
  const { onOpenFile } = preview("[x](javascript:alert(1))");
  const a = screen.getByText("x");
  fireEvent.click(a);
  expect(hostOpenExternal).not.toHaveBeenCalled();
  expect(onOpenFile).not.toHaveBeenCalled();
  expect(a.getAttribute("href") ?? "").not.toMatch(/javascript/i);
});

it("scrolls to a heading for a #anchor, via the prefixed id", () => {
  const scroll = vi.fn();
  Element.prototype.scrollIntoView = scroll;
  const { container } = preview(
    "[go](#getting-started)\n\n## Getting started\n",
  );
  fireEvent.click(screen.getByText("go"));
  expect(scroll).toHaveBeenCalledTimes(1);
  expect(scroll.mock.contexts[0]).toBe(
    container.querySelector("#md-getting-started"),
  );
});

it("loads a repo image from disk, relative to the file", async () => {
  const { container } = preview("![shot](img/a.png)", "docs/x.md");
  await waitFor(() =>
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "data:image/png;base64,AAAA",
    ),
  );
  expect(readImageDataUrl).toHaveBeenCalledWith("/proj", "docs/img/a.png");
});

it("shows a remote image's alt text instead of a CSP-blocked broken icon", () => {
  const { container } = preview("![build passing](https://img.shields.io/x)");
  expect(container.querySelector("img")).toBeNull();
  expect(screen.getByText("build passing")).toBeTruthy();
  expect(readImageDataUrl).not.toHaveBeenCalled();
});

it("says so when the file was too large to read whole", () => {
  render(
    <MarkdownPreview
      root="/proj"
      relPath="big.md"
      file={file("# part", { truncated: true })}
      onOpenFile={vi.fn()}
    />,
  );
  expect(screen.getByText(/only the beginning/i)).toBeTruthy();
});

it("re-reads when THIS project's files change, so Claude's edits appear", async () => {
  vi.useFakeTimers();
  preview("# stale");
  readFile.mockImplementation(async () => file("# fresh"));
  expect(screen.getByRole("heading").textContent).toBe("stale");
  act(() => {
    for (const l of fsListeners) l({ root: "/other" });
  });
  await act(async () => {
    await vi.runAllTimersAsync();
  });
  // A mount re-read happens once; another project's change adds nothing.
  const afterOther = readFile.mock.calls.length;
  act(() => {
    for (const l of fsListeners) l({ root: "/proj" });
  });
  await act(async () => {
    await vi.runAllTimersAsync();
  });
  expect(readFile.mock.calls.length).toBe(afterOther + 1);
  expect(readFile).toHaveBeenLastCalledWith("/proj", "README.md");
  expect(screen.getByRole("heading").textContent).toBe("fresh");
});

it("opens in PREVIEW and toggles to the editor and back", () => {
  render(
    <MarkdownFile
      tabId="t1"
      root="/proj"
      relPath="README.md"
      file={file("# Hello")}
      theme="dark"
    />,
  );
  expect(screen.getByRole("heading").textContent).toBe("Hello");
  expect(screen.queryByTestId("editor")).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  expect(screen.getByTestId("editor").textContent).toBe("editing README.md");
  expect(screen.queryByRole("heading")).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Preview" }));
  expect(screen.queryByTestId("editor")).toBeNull();
});

it("marks the active mode for assistive tech", () => {
  render(
    <MarkdownFile
      tabId="t1"
      root="/proj"
      relPath="README.md"
      file={file("x")}
      theme="dark"
    />,
  );
  const previewBtn = screen.getByRole("button", { name: "Preview" });
  const editBtn = screen.getByRole("button", { name: "Edit" });
  expect(previewBtn.getAttribute("aria-pressed")).toBe("true");
  expect(editBtn.getAttribute("aria-pressed")).toBe("false");
});
