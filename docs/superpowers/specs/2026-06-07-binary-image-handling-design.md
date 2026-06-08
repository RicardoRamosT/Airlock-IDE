# Binary File + Image Handling -- Design

**Date:** 2026-06-07
**Status:** Approved (pending spec review)

## Goal

Stop opening binary files (images, pdf, zip, fonts, ...) as garbled UTF-8 in the
editor. Detect binary content and, instead of byte-soup, either **preview the
image** (raster formats) or show a clean **"binary file" notice** with an
"Open externally" action.

## Background

The editor reads any file via `readWorkspaceFile` (`agent-core/workspace/
read.ts`), which does `buffer.toString("utf8")` unconditionally, so a PNG renders
as `<NUL>PNG IHDR IDAT ...` mojibake. `ProjectPane.editorArea(relPath, content)`
is the single place that renders `<EditorPane>` from the stored `FileContent`.

## Decisions (locked with the user)

1. **Detect binary at read time.** A NUL byte in the first 8000 bytes means
   binary (the heuristic git uses). Binary files return empty content -- never a
   UTF-8 dump. `FileContent` gains `binary: boolean` and `size: number`.
2. **Route by type at render** (in `editorArea`): raster image extension ->
   image preview; else `content.binary` -> binary notice; else -> the editor
   (unchanged).
3. **Images preview above the text cap.** Rendering a picture is cheap, so images
   load up to ~25 MB (over that -> "open externally"). The 1 MB *text*-edit cap
   is unchanged -- this feature is about file *type*, not size.
4. **SVG stays text.** It is editable XML and not binary (no NUL), so it edits as
   text rather than previewing as an image.
5. **Open externally** uses `shell.openPath` (mirrors the existing
   `shell.openExternal`/`trashItem`), path-confined + vault-guarded.

## Non-goals (YAGNI)

- PDF / hex / archive viewers -- binaries get the notice + open-externally only.
- SVG image preview, image zoom/pan, EXIF, animated-gif controls.
- Raising or splitting the 1 MB text cap (separate question).

## Components and data flow

### agent-core (`workspace/read.ts`)

- `FileContent` -> `{ content: string; truncated: boolean; binary: boolean; size: number }`.
- `readWorkspaceFile`: stat for `size`; read an 8000-byte probe; if it contains a
  `0x00` byte -> return `{ content: "", truncated: false, binary: true, size }`
  (skip the full read). Otherwise the existing text path (whole file if
  `<= MAX_FILE_BYTES`, else first `MAX_FILE_BYTES` with `truncated: true`), now
  also returning `binary: false` and `size`.
  - Caveat: UTF-16 text (NUL-interleaved) is treated as binary, matching git.
    Acceptable for this codebase.
- New `readImageDataUrl(root, relPath, max = 25_000_000): Promise<{ dataUrl:
  string; tooLarge: boolean }>`: path-confined; if `size > max` ->
  `{ dataUrl: "", tooLarge: true }`; else read bytes and return
  `{ dataUrl: "data:<mime>;base64,<...>", tooLarge: false }` where `<mime>` comes
  from a small extension->mime map (png/jpg/jpeg/gif/webp/bmp/ico/avif; default
  `application/octet-stream`). ASCII-only file.

### main (`main/ipc.ts`) + preload + shared

- `shared/ipc.ts`: `FileContent` re-export already carries the new fields. Add to
  `AirlockApi`:
  - `readImageDataUrl(root: string, relPath: string): Promise<{ dataUrl: string; tooLarge: boolean }>`
  - `openExternalFile(root: string, relPath: string): Promise<void>`
- `preload/index.ts`: wire `fs:readImage` and `fs:openExternalFile`.
- `main/ipc.ts`:
  - `ipcMain.handle("fs:readImage", ...)` -> validate `relPath` string,
    `assertNotVault(relPath)`, `readImageDataUrl(resolveRoot(e, root), relPath)`.
  - `ipcMain.handle("fs:openExternalFile", ...)` -> validate, `assertNotVault`,
    `shell.openPath(await resolveWithin(resolveRoot(e, root), relPath))`
    (`shell` and `resolveWithin` are already imported here).

### renderer

- `lib/imageTypes.ts` (new, pure): `IMAGE_EXTS` set + `isImagePath(relPath):
  boolean` (lowercased extension test). Unit-testable.
- `components/ImagePreview.tsx` (new): on mount fetch `readImageDataUrl(root,
  relPath)`. States: loading -> `<img class="image-preview">`; `tooLarge` or
  error -> a message + an **Open externally** button (`openExternalFile`).
- `components/BinaryNotice.tsx` (new): "Binary file -- <formatted size> -- not
  shown" + an **Open externally** button. Takes `root`, `relPath`, `size`.
- `components/ProjectPane.tsx`: in `editorArea`, branch before `<EditorPane>`:

  ```tsx
  isImagePath(relPath) ? (
    <ImagePreview root={root} relPath={relPath} />
  ) : content.binary ? (
    <BinaryNotice root={root} relPath={relPath} size={content.size} />
  ) : (
    <EditorPane key={relPath} root={root} relPath={relPath} file={content} theme={theme} />
  )
  ```

- `theme.css`: `.image-preview` (contain within the pane, checkerboard or plain
  bg, max-width/height 100%, centered) + `.binary-notice` (centered message +
  button).

Flow: opening an image still goes through `openEditorFile` -> `readFile`, which
now cheaply returns `binary: true` (8 KB probe, no full decode); the tab opens
as usual; `editorArea` sees the image extension and renders `<ImagePreview>`,
which fetches the data URL separately. A non-image binary renders `<BinaryNotice>`.

## Error handling

- `readImageDataUrl` reject (unreadable) -> ImagePreview shows the error state +
  open-externally; never throws into render.
- `tooLarge` -> explicit "image too large to preview" + open-externally.
- `openExternalFile` reject -> logged; no crash.

## Testing

- `read.test.ts` (agent-core): a file containing a NUL byte -> `binary: true`,
  `content: ""`; a normal text file -> `binary: false`, content present, `size`
  correct. `readImageDataUrl`: a small PNG -> `dataUrl` starts with
  `data:image/png;base64,`; a file over `max` -> `tooLarge: true`.
- `lib/imageTypes.test.ts` (renderer): `isImagePath` true for `a.png`/`b.JPG`,
  false for `c.ts`/`d.svg`.
- `components/ProjectPane` (or focused `ImagePreview`/`BinaryNotice`) jsdom test:
  an image path renders an `<img>` whose `src` is the fetched data URL; a binary
  `FileContent` renders the notice and its Open-externally button calls
  `openExternalFile(root, relPath)`.

## Constraints

- ASCII-only in `agent-core/workspace/read.ts`, `main/ipc.ts`, `shared/ipc.ts`,
  `preload/index.ts` (CJS bundling -- use `--`).
- Renderer `.tsx`/`.css`/`lib/*.ts` and this doc are exempt.
