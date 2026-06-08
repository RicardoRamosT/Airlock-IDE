# Binary File + Image Handling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect binary files at read time so the editor previews images and shows a clean notice for other binaries, instead of dumping UTF-8 byte-soup.

**Architecture:** `read.ts` flags binary content (NUL-byte probe) and exposes an image-as-data-URL reader; `ProjectPane.editorArea` routes by type -- raster image -> `<ImagePreview>`, else binary -> `<BinaryNotice>` (Open externally via `shell.openPath`), else the existing `<EditorPane>`.

**Tech Stack:** Electron + electron-vite, React 19, Zustand, TypeScript (strict), vitest, biome.

**Spec:** `docs/superpowers/specs/2026-06-07-binary-image-handling-design.md`

---

## Conventions for every task

- **ASCII-only** in `packages/agent-core/**`, `packages/app/src/main/**`,
  `packages/app/src/preload/**`, `packages/app/src/shared/ipc.ts` (CJS bundling;
  use `--`). Renderer `.tsx`/`.css`/`.ts` and this plan are exempt.
- Commands (repo root `/Users/ricardoramos/Projects/airlock`): one test file
  `npx vitest run <path>`; typecheck `npm run typecheck`; lint
  `npx biome check --write <paths>` then `npx biome check <paths>`.
- Branch: `feat/binary-preview` (already created). Do NOT push.

## File structure

| File | Responsibility | Task |
|------|----------------|------|
| `packages/agent-core/src/workspace/read.ts` | `binary`+`size` on FileContent; `readImageDataUrl` | 1 |
| `packages/agent-core/src/index.ts` | export `readImageDataUrl` | 1 |
| `packages/app/src/shared/ipc.ts` | `readImageDataUrl` + `openExternalFile` on AirlockApi | 2 |
| `packages/app/src/preload/index.ts` | wire both IPCs | 2 |
| `packages/app/src/main/ipc.ts` | `fs:readImage` + `fs:openExternalFile` handlers | 2 |
| `packages/app/src/renderer/src/lib/imageTypes.ts` (new) | pure `isImagePath` | 3 |
| `packages/app/src/renderer/src/components/ImagePreview.tsx` (new) | inline image preview | 4 |
| `packages/app/src/renderer/src/components/BinaryNotice.tsx` (new) | binary notice + open externally | 4 |
| `packages/app/src/renderer/src/components/ProjectPane.tsx` | route in `editorArea` | 4 |
| `packages/app/src/renderer/src/theme.css` | preview + notice styles | 4 |

---

## Task 1: read-time binary detection + image data URL

**Files:**
- Modify: `packages/agent-core/src/workspace/read.ts`
- Modify: `packages/agent-core/src/index.ts`
- Test: `packages/agent-core/src/workspace/read.test.ts`

- [ ] **Step 1: Write the failing tests.**

In `packages/agent-core/src/workspace/read.test.ts`, add `readImageDataUrl` to the `./read` import, then add:

```ts
it("flags small text as non-binary with its size", async () => {
  const f = await readWorkspaceFile(root, "small.txt");
  expect(f.binary).toBe(false);
  expect(f.size).toBe(13); // "hello airlock"
});

it("treats a file containing a NUL byte as binary (empty content)", async () => {
  await writeFile(path.join(root, "blob.bin"), Buffer.from([0x50, 0x00, 0x4e]));
  const f = await readWorkspaceFile(root, "blob.bin");
  expect(f.binary).toBe(true);
  expect(f.content).toBe("");
});

it("readImageDataUrl returns a data URL for a png", async () => {
  await writeFile(path.join(root, "x.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const r = await readImageDataUrl(root, "x.png");
  expect(r.tooLarge).toBe(false);
  expect(r.dataUrl.startsWith("data:image/png;base64,")).toBe(true);
});

it("readImageDataUrl flags an over-cap file as tooLarge", async () => {
  await writeFile(path.join(root, "huge.png"), Buffer.alloc(100));
  const r = await readImageDataUrl(root, "huge.png", 50);
  expect(r.tooLarge).toBe(true);
  expect(r.dataUrl).toBe("");
});
```

- [ ] **Step 2: Run to confirm failure.**

Run: `npx vitest run packages/agent-core/src/workspace/read.test.ts`
Expected: FAIL -- `binary`/`size` undefined and `readImageDataUrl` not exported.

- [ ] **Step 3: Update `read.ts`.**

Replace the `FileContent` interface and `readWorkspaceFile`, and append
`readImageDataUrl` + the mime map. Full new file body (keep the top
`import { open } from "node:fs/promises";` and `import { resolveWithin } from "./tree";`):

```ts
export interface FileContent {
  content: string;
  truncated: boolean;
  binary: boolean;
  size: number;
}

export const MAX_FILE_BYTES = 1_000_000;

export async function readWorkspaceFile(
  root: string,
  relPath: string,
): Promise<FileContent> {
  const abs = await resolveWithin(root, relPath);
  const fh = await open(abs, "r");
  try {
    const { size } = await fh.stat();
    // Binary probe: a NUL byte in the first 8000 bytes means binary (git's
    // heuristic). Skip the UTF-8 decode so the editor never shows byte-soup.
    const probeLen = Math.min(size, 8000);
    if (probeLen > 0) {
      const probe = Buffer.alloc(probeLen);
      await fh.read(probe, 0, probeLen, 0);
      if (probe.includes(0))
        return { content: "", truncated: false, binary: true, size };
    }
    if (size <= MAX_FILE_BYTES) {
      const buf = await fh.readFile();
      return {
        content: buf.toString("utf8"),
        truncated: false,
        binary: false,
        size,
      };
    }
    // NOTE: truncating at a byte boundary can split a multi-byte UTF-8
    // codepoint; Buffer.toString('utf8') replaces the broken tail with U+FFFD.
    // Acceptable for the read-only viewer (truncated:true is already set).
    const buf = Buffer.alloc(MAX_FILE_BYTES);
    await fh.read(buf, 0, MAX_FILE_BYTES, 0);
    return {
      content: buf.toString("utf8"),
      truncated: true,
      binary: false,
      size,
    };
  } finally {
    await fh.close();
  }
}

// Extension -> mime for inline image preview. Keep in sync with IMAGE_EXTS in
// the renderer's lib/imageTypes.ts.
const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  ico: "image/x-icon",
  avif: "image/avif",
};

// Read a (raster) image as a data URL for the renderer's <img>. Path-confined.
// Over `max` bytes -> { dataUrl: "", tooLarge: true } so the caller can offer
// "open externally". Never decodes as text. ASCII-only file.
export async function readImageDataUrl(
  root: string,
  relPath: string,
  max = 25_000_000,
): Promise<{ dataUrl: string; tooLarge: boolean }> {
  const abs = await resolveWithin(root, relPath);
  const fh = await open(abs, "r");
  try {
    const { size } = await fh.stat();
    if (size > max) return { dataUrl: "", tooLarge: true };
    const buf = await fh.readFile();
    const ext = relPath.slice(relPath.lastIndexOf(".") + 1).toLowerCase();
    const mime = IMAGE_MIME[ext] ?? "application/octet-stream";
    return {
      dataUrl: `data:${mime};base64,${buf.toString("base64")}`,
      tooLarge: false,
    };
  } finally {
    await fh.close();
  }
}
```

- [ ] **Step 4: Export `readImageDataUrl`.**

In `packages/agent-core/src/index.ts`, update the `./workspace/read` export block:

```ts
export {
  type FileContent,
  MAX_FILE_BYTES,
  readImageDataUrl,
  readWorkspaceFile,
} from "./workspace/read";
```

- [ ] **Step 5: Update the FileContent literals in `store.test.ts`.**

`packages/app/src/renderer/src/store.test.ts` builds `FileContent` fixtures and
passes them to `openFile` (whose `file` arg is unused at runtime, but the literal
is still type-checked against `FileContent`). The two new fields are required, so
add them to each of the three sites: the two `const FILE = { content: "x",
truncated: false };` (around lines 914 and 1034) and the inline
`openFile("other.ts", { content: "y", truncated: false })` (around line 1007).
Make each:

```ts
const FILE = { content: "x", truncated: false, binary: false, size: 1 };
// and the inline one:
get().openFile("other.ts", { content: "y", truncated: false, binary: false, size: 1 });
```

- [ ] **Step 6: Run tests + typecheck.**

Run: `npx vitest run packages/agent-core/src/workspace/read.test.ts packages/app/src/renderer/src/store.test.ts` -> PASS.
Run: `npm run typecheck` -> clean (the `store.test.ts` literals now satisfy the
widened `FileContent`; all other consumers only read `.content`/`.truncated`).

- [ ] **Step 7: Lint + commit.**

```bash
npx biome check --write packages/agent-core/src/workspace/read.ts packages/agent-core/src/workspace/read.test.ts packages/agent-core/src/index.ts packages/app/src/renderer/src/store.test.ts
git add packages/agent-core/src/workspace/read.ts packages/agent-core/src/workspace/read.test.ts packages/agent-core/src/index.ts packages/app/src/renderer/src/store.test.ts
git commit -m "feat(viewer): detect binary at read time + readImageDataUrl"
```

---

## Task 2: IPC for image data URL + open externally

**Files:**
- Modify: `packages/app/src/shared/ipc.ts` (AirlockApi, after the `writeFile` line)
- Modify: `packages/app/src/preload/index.ts` (after the `writeFile` line)
- Modify: `packages/app/src/main/ipc.ts` (after the `fs:readFile` handler)

- [ ] **Step 1: Add to `AirlockApi` (shared/ipc.ts).**

After the `writeFile(...)` line:

```ts
  // Read a (raster) image as a data URL for inline preview. Over ~25 MB ->
  // { dataUrl: "", tooLarge: true } (the UI offers Open Externally).
  readImageDataUrl(
    root: string,
    relPath: string,
  ): Promise<{ dataUrl: string; tooLarge: boolean }>;
  // Open a workspace file in the OS default app (binary files / oversized
  // images). Path-confined; the .airlock vault is rejected.
  openExternalFile(root: string, relPath: string): Promise<void>;
```

- [ ] **Step 2: Wire preload (preload/index.ts), after the `writeFile` line:**

```ts
  readImageDataUrl: (root, relPath) =>
    ipcRenderer.invoke("fs:readImage", root, relPath),
  openExternalFile: (root, relPath) =>
    ipcRenderer.invoke("fs:openExternalFile", root, relPath),
```

- [ ] **Step 3: Add the main handlers (main/ipc.ts).**

Add `readImageDataUrl` to the existing `@airlock/agent-core` import. Then right
after the `ipcMain.handle("fs:readFile", ...)` handler add (`shell`,
`resolveWithin`, `assertNotVault`, `resolveRoot` are already in this file):

```ts
  ipcMain.handle("fs:readImage", (e, root: unknown, relPath: unknown) => {
    if (typeof relPath !== "string") throw new Error("Invalid payload");
    assertNotVault(relPath);
    return readImageDataUrl(resolveRoot(e, root), relPath);
  });
  ipcMain.handle(
    "fs:openExternalFile",
    async (e, root: unknown, relPath: unknown) => {
      if (typeof relPath !== "string") throw new Error("Invalid payload");
      assertNotVault(relPath);
      const abs = await resolveWithin(resolveRoot(e, root), relPath);
      await shell.openPath(abs);
    },
  );
```

- [ ] **Step 4: Verify.**

Run: `npm run typecheck` -> clean (the new AirlockApi methods are implemented in preload).
Confirm ASCII-only on the three files (comments use `--`).

- [ ] **Step 5: Lint + commit.**

```bash
npx biome check --write packages/app/src/shared/ipc.ts packages/app/src/preload/index.ts packages/app/src/main/ipc.ts
git add packages/app/src/shared/ipc.ts packages/app/src/preload/index.ts packages/app/src/main/ipc.ts
git commit -m "feat(viewer): fs:readImage + fs:openExternalFile IPC"
```

---

## Task 3: pure image-type helper

**Files:**
- Create: `packages/app/src/renderer/src/lib/imageTypes.ts`
- Test: `packages/app/src/renderer/src/lib/imageTypes.test.ts`

- [ ] **Step 1: Write the failing test.**

Create `packages/app/src/renderer/src/lib/imageTypes.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isImagePath } from "./imageTypes";

describe("isImagePath", () => {
  it("matches raster image extensions, case-insensitively", () => {
    expect(isImagePath("a/b/photo.png")).toBe(true);
    expect(isImagePath("ICON.JPG")).toBe(true);
    expect(isImagePath("x.webp")).toBe(true);
  });
  it("rejects non-images, svg (edits as text), and extensionless", () => {
    expect(isImagePath("main.ts")).toBe(false);
    expect(isImagePath("logo.svg")).toBe(false);
    expect(isImagePath("noext")).toBe(false);
  });
});
```

- [ ] **Step 2: Run to confirm failure.**

Run: `npx vitest run packages/app/src/renderer/src/lib/imageTypes.test.ts`
Expected: FAIL -- module missing.

- [ ] **Step 3: Implement `imageTypes.ts`.**

```ts
// Raster image extensions the viewer previews inline. SVG is intentionally NOT
// here -- it edits as text. Keep in sync with IMAGE_MIME in agent-core read.ts.
const IMAGE_EXTS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "ico",
  "avif",
]);

export function isImagePath(relPath: string): boolean {
  const i = relPath.lastIndexOf(".");
  if (i < 0) return false;
  return IMAGE_EXTS.has(relPath.slice(i + 1).toLowerCase());
}
```

- [ ] **Step 4: Run + typecheck + lint + commit.**

Run: `npx vitest run packages/app/src/renderer/src/lib/imageTypes.test.ts` -> PASS.
Run: `npm run typecheck` -> clean.
```bash
npx biome check --write packages/app/src/renderer/src/lib/imageTypes.ts packages/app/src/renderer/src/lib/imageTypes.test.ts
git add packages/app/src/renderer/src/lib/imageTypes.ts packages/app/src/renderer/src/lib/imageTypes.test.ts
git commit -m "feat(viewer): isImagePath helper"
```

---

## Task 4: ImagePreview + BinaryNotice + routing + CSS

**Files:**
- Create: `packages/app/src/renderer/src/components/ImagePreview.tsx`
- Create: `packages/app/src/renderer/src/components/BinaryNotice.tsx`
- Modify: `packages/app/src/renderer/src/components/ProjectPane.tsx`
- Modify: `packages/app/src/renderer/src/theme.css`
- Test: `packages/app/src/renderer/src/components/BinaryViewer.test.tsx`

- [ ] **Step 1: Write the failing test.**

Create `packages/app/src/renderer/src/components/BinaryViewer.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BinaryNotice } from "./BinaryNotice";
import { ImagePreview } from "./ImagePreview";

let readImageDataUrl: ReturnType<typeof vi.fn>;
let openExternalFile: ReturnType<typeof vi.fn>;

beforeEach(() => {
  readImageDataUrl = vi.fn(() =>
    Promise.resolve({ dataUrl: "data:image/png;base64,AAA", tooLarge: false }),
  );
  openExternalFile = vi.fn(() => Promise.resolve());
  window.airlock = new Proxy(
    { readImageDataUrl, openExternalFile },
    {
      get: (t, p) =>
        p in t
          ? (t as Record<string, unknown>)[p as string]
          : () => Promise.resolve(undefined),
    },
  ) as unknown as typeof window.airlock;
});
afterEach(() => cleanup());

it("ImagePreview renders the fetched data URL", async () => {
  const { container } = render(<ImagePreview root="/r" relPath="a.png" />);
  await waitFor(() => {
    const img = container.querySelector("img.image-preview") as HTMLImageElement;
    expect(img?.getAttribute("src")).toBe("data:image/png;base64,AAA");
  });
  expect(readImageDataUrl).toHaveBeenCalledWith("/r", "a.png");
});

it("ImagePreview shows Open externally when too large", async () => {
  readImageDataUrl.mockReturnValueOnce(
    Promise.resolve({ dataUrl: "", tooLarge: true }),
  );
  const { findByText } = render(<ImagePreview root="/r" relPath="big.png" />);
  fireEvent.click(await findByText("Open externally"));
  expect(openExternalFile).toHaveBeenCalledWith("/r", "big.png");
});

it("BinaryNotice shows a formatted size and opens externally", () => {
  const { getByText } = render(
    <BinaryNotice root="/r" relPath="a.zip" size={1_500_000} />,
  );
  expect(getByText(/1\.4 MB/)).toBeTruthy();
  fireEvent.click(getByText("Open externally"));
  expect(openExternalFile).toHaveBeenCalledWith("/r", "a.zip");
});
```

- [ ] **Step 2: Run to confirm failure.**

Run: `npx vitest run packages/app/src/renderer/src/components/BinaryViewer.test.tsx`
Expected: FAIL -- modules missing.

- [ ] **Step 3: Implement `ImagePreview.tsx`.**

```tsx
import { useEffect, useState } from "react";

type State =
  | { kind: "loading" }
  | { kind: "ok"; dataUrl: string }
  | { kind: "too-large" }
  | { kind: "error" };

// Inline preview for a raster image. Fetches a data URL (own process, never
// decoded as text); falls back to an Open-externally action when the image is
// too large to inline or fails to load.
export function ImagePreview({
  root,
  relPath,
}: {
  root: string;
  relPath: string;
}) {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    window.airlock
      .readImageDataUrl(root, relPath)
      .then((r) => {
        if (cancelled) return;
        setState(
          r.tooLarge ? { kind: "too-large" } : { kind: "ok", dataUrl: r.dataUrl },
        );
      })
      .catch((err) => {
        console.error("readImageDataUrl failed", err);
        if (!cancelled) setState({ kind: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [root, relPath]);

  if (state.kind === "loading")
    return <div className="viewer-host empty">loading…</div>;
  if (state.kind === "ok")
    return (
      <div className="image-preview-host">
        <img
          className="image-preview"
          src={state.dataUrl}
          alt={relPath}
          onError={() => setState({ kind: "error" })}
        />
      </div>
    );
  return (
    <div className="binary-notice">
      <div>
        {state.kind === "too-large"
          ? "Image too large to preview."
          : "Could not preview this image."}
      </div>
      <button
        type="button"
        className="btn"
        onClick={() => void window.airlock.openExternalFile(root, relPath)}
      >
        Open externally
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Implement `BinaryNotice.tsx`.**

```tsx
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Shown for a non-image binary file instead of byte-soup: what it is, how big,
// and a way to open it in the OS default app.
export function BinaryNotice({
  root,
  relPath,
  size,
}: {
  root: string;
  relPath: string;
  size: number;
}) {
  return (
    <div className="binary-notice">
      <div>Binary file -- {formatSize(size)} -- not shown</div>
      <button
        type="button"
        className="btn"
        onClick={() => void window.airlock.openExternalFile(root, relPath)}
      >
        Open externally
      </button>
    </div>
  );
}
```

- [ ] **Step 5: Route in `ProjectPane.tsx`.**

Add imports near the other component imports:

```ts
import { isImagePath } from "../lib/imageTypes";
import { BinaryNotice } from "./BinaryNotice";
import { ImagePreview } from "./ImagePreview";
```

Replace the `editorArea` body's inner ternary so the three branches route by type:

```tsx
  const editorArea = (relPath: string, content: FileContent | null) => (
    <div className="editor-area">
      {root && content ? (
        isImagePath(relPath) ? (
          <ImagePreview key={relPath} root={root} relPath={relPath} />
        ) : content.binary ? (
          <BinaryNotice
            key={relPath}
            root={root}
            relPath={relPath}
            size={content.size}
          />
        ) : (
          <EditorPane
            key={relPath}
            root={root}
            relPath={relPath}
            file={content}
            theme={theme}
          />
        )
      ) : (
        <div className="empty">loading…</div>
      )}
    </div>
  );
```

- [ ] **Step 6: Add CSS (theme.css), appended at the end.**

```css
/* Image preview + binary-file notice in the editor area. */
.image-preview-host {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  overflow: auto;
  background: var(--bg);
}
.image-preview {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}
.binary-notice {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  height: 100%;
  background: var(--bg);
  color: var(--fg-dim);
  font-size: 13px;
}
```

- [ ] **Step 7: Run the test + the components dir + typecheck.**

Run: `npx vitest run packages/app/src/renderer/src/components/BinaryViewer.test.tsx` -> PASS.
Run: `npx vitest run packages/app/src/renderer/src/components/` -> all PASS (no regressions).
Run: `npm run typecheck` -> clean.

- [ ] **Step 8: Lint + commit.**

```bash
npx biome check --write packages/app/src/renderer/src/components/ImagePreview.tsx packages/app/src/renderer/src/components/BinaryNotice.tsx packages/app/src/renderer/src/components/ProjectPane.tsx packages/app/src/renderer/src/components/BinaryViewer.test.tsx packages/app/src/renderer/src/theme.css
git add packages/app/src/renderer/src/components/ImagePreview.tsx packages/app/src/renderer/src/components/BinaryNotice.tsx packages/app/src/renderer/src/components/ProjectPane.tsx packages/app/src/renderer/src/components/BinaryViewer.test.tsx packages/app/src/renderer/src/theme.css
git commit -m "feat(viewer): image preview + binary-file notice with open externally"
```

---

## Final verification (after all tasks)

- [ ] `npx vitest run` -- all green.
- [ ] `npm run typecheck` -- clean.
- [ ] `npx biome check .` -- clean.
- [ ] `npm run package` -- build for the owner to gate.

## Manual gate checklist (owner)

- Open a PNG/JPG -> the image renders (no byte-soup).
- Open a non-image binary (e.g. a `.zip` or a font) -> "Binary file -- N MB" + Open externally works.
- Open an SVG -> still opens as editable text.
- Open a normal source file -> edits exactly as before.
- Open a >25 MB image -> "Image too large to preview" + Open externally.
