// MarkdownPreview.tsx
// A .md file opens RENDERED, GitHub-style, with a Preview | Edit toggle; Edit is
// the ordinary EditorPane, so autosave and conflict handling are the editor's
// own and nothing here re-implements them.
//
// Why a real CommonMark renderer rather than OverviewMarkdown's parser: that one
// is a subset for Overview snippets and cannot render a whole document -- an
// INDENTED code block (Trackview's README) came out as one run-on paragraph.
// react-markdown builds React elements, so like the Overview there is no
// dangerouslySetInnerHTML anywhere, and raw HTML is dropped (skipHtml).
import {
  type ComponentPropsWithoutRef,
  type MouseEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { FileContent } from "../../../shared/ipc";
import { openEditorFile } from "../lib/editorFiles";
import { highlightSpans } from "../lib/highlightCode";
import { HEADING_ID_PREFIX, rehypeHeadingIds } from "../lib/markdownHeadings";
import {
  resolveMarkdownHref,
  resolveMarkdownImage,
} from "../lib/markdownLinks";
import { EditorPane } from "./EditorPane";

// fs:changed is per ROOT and already debounced 150ms in main; a build writing
// hundreds of files would still re-read on every burst, so coalesce once more.
const REREAD_MS = 200;

type Mode = "preview" | "edit";

// The file as opened: preview first (you read these far more often than you
// type into them -- most markdown here is written by Claude), Edit on demand.
// The mode is per open and resets on the next open, deliberately: a remembered
// "edit" would silently undo the whole point for that file.
export function MarkdownFile({
  tabId,
  root,
  relPath,
  file,
  theme,
}: {
  tabId: string;
  root: string;
  relPath: string;
  file: FileContent;
  theme: "dark" | "light";
}) {
  const [mode, setMode] = useState<Mode>("preview");
  return (
    <div className="md-file">
      <div className="md-toolbar">
        {/* The app's segmented control (.seg), as in the agent policy rows:
            aria-pressed buttons, the pressed one is the mode showing. */}
        <div className="seg">
          {(["preview", "edit"] as const).map((m) => (
            <button
              key={m}
              type="button"
              className={mode === m ? "seg-btn seg-on seg-view" : "seg-btn"}
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
            >
              <i
                className={`codicon codicon-${m === "preview" ? "preview" : "edit"}`}
                aria-hidden="true"
              />
              {m === "preview" ? "Preview" : "Edit"}
            </button>
          ))}
        </div>
      </div>
      <div className="md-file-body">
        {mode === "preview" ? (
          <MarkdownPreview
            root={root}
            relPath={relPath}
            file={file}
            onOpenFile={(p) => void openEditorFile(tabId, p)}
          />
        ) : (
          <EditorPane
            tabId={tabId}
            root={root}
            relPath={relPath}
            file={file}
            theme={theme}
          />
        )}
      </div>
    </div>
  );
}

export function MarkdownPreview({
  root,
  relPath,
  file,
  onOpenFile,
}: {
  root: string;
  relPath: string;
  /** The read ProjectPane already did -- the first paint needs no fetch. */
  file: FileContent;
  onOpenFile: (rootRelPath: string) => void;
}) {
  const [doc, setDoc] = useState({
    text: file.content,
    truncated: file.truncated,
  });
  const hostRef = useRef<HTMLDivElement>(null);

  // Keep the preview true to DISK. The `file` prop is ProjectPane's one read per
  // path, so it is stale after an Edit session or after Claude rewrites the
  // file. Re-read once on mount (catches edits made in Edit mode; the editor's
  // final autosave also lands as an fs:changed) and on every change in this
  // root. A failed re-read keeps what is on screen -- blanking a document you
  // are reading because one read raced a rename would be worse.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const reread = () => {
      window.airlock
        .readFile(root, relPath)
        .then((f) => {
          if (cancelled || f.binary) return;
          setDoc((cur) =>
            cur.text === f.content && cur.truncated === f.truncated
              ? cur
              : { text: f.content, truncated: f.truncated },
          );
        })
        .catch(() => {});
    };
    reread();
    const off = window.airlock.onFsChanged((e) => {
      if (e.root !== root) return;
      clearTimeout(timer);
      timer = setTimeout(reread, REREAD_MS);
    });
    return () => {
      cancelled = true;
      clearTimeout(timer);
      off();
    };
  }, [root, relPath]);

  const onLink =
    (href: string | undefined) =>
    (e: MouseEvent<HTMLAnchorElement>): void => {
      // Never let the renderer navigate: a relative href would replace the app.
      e.preventDefault();
      const target = resolveMarkdownHref(relPath, href ?? "");
      if (!target) return;
      if (target.kind === "external") {
        void window.airlock.hostOpenExternal(target.url);
      } else if (target.kind === "file") {
        onOpenFile(target.path);
      } else {
        // Scoped to THIS preview: a split pane may show another document with
        // the same heading, and its id must not win.
        // Compared, not built into a selector: the id comes from the document.
        const id = HEADING_ID_PREFIX + target.id;
        const el = [
          ...(hostRef.current?.querySelectorAll("h1,h2,h3,h4,h5,h6") ?? []),
        ].find((h) => h.id === id);
        el?.scrollIntoView({ block: "start" });
      }
    };

  const components: Components = {
    a: ({ href, children, node: _n, ...rest }) => {
      const ok = resolveMarkdownHref(relPath, href ?? "") !== null;
      return (
        <a
          {...rest}
          // An unresolvable link keeps its text but loses its target, so
          // neither a click nor a copied link carries the unsafe URL.
          href={ok ? href : undefined}
          title={ok ? href : undefined}
          onClick={onLink(href)}
        >
          {children}
        </a>
      );
    },
    img: ({ src, alt }) => (
      <MarkdownImage
        root={root}
        relPath={relPath}
        src={typeof src === "string" ? src : ""}
        alt={alt ?? ""}
      />
    ),
    code: ({ className, children, node: _n, ...rest }) => (
      <HighlightedCode className={className} rest={rest}>
        {children}
      </HighlightedCode>
    ),
    // Wide tables scroll inside themselves rather than widening the page.
    table: ({ node: _n, ...props }) => (
      <div className="md-table-wrap">
        <table {...props} />
      </div>
    ),
  };

  return (
    <div className="md-preview" ref={hostRef}>
      <article className="md-body">
        {doc.truncated && (
          <div className="md-note">
            This file is large, so only the beginning is shown. Switch to Edit
            to see it as text.
          </div>
        )}
        <Markdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeHeadingIds]}
          skipHtml
          components={components}
        >
          {doc.text}
        </Markdown>
      </article>
    </div>
  );
}

function HighlightedCode({
  className,
  children,
  rest,
}: {
  className: string | undefined;
  children: ReactNode;
  rest: ComponentPropsWithoutRef<"code">;
}) {
  // Fenced blocks arrive as <code class="language-xx">; inline code and
  // indented blocks carry no class and render untouched.
  const lang = /\blanguage-(\S+)/.exec(className ?? "")?.[1] ?? null;
  const spans =
    lang && typeof children === "string"
      ? highlightSpans(children.replace(/\n$/, ""), lang)
      : null;
  if (!spans)
    return (
      <code {...rest} className={className}>
        {children}
      </code>
    );
  return (
    <code {...rest} className={className}>
      {spans.map((s, i) =>
        s.cls ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: spans of a static code block are positionally stable
          <span key={i} className={s.cls}>
            {s.text}
          </span>
        ) : (
          s.text
        ),
      )}
    </code>
  );
}

type ImgState =
  | { kind: "loading" }
  | { kind: "ok"; src: string }
  | { kind: "alt" };

// The renderer CSP is `img-src 'self' data:`. A repo image is read from disk
// into a data URL (the same path ImagePreview uses); a remote one would be
// blocked and paint a broken icon, so it shows its alt text instead -- which for
// the usual shields.io badge ("build passing") is the information anyway.
function MarkdownImage({
  root,
  relPath,
  src,
  alt,
}: {
  root: string;
  relPath: string;
  src: string;
  alt: string;
}) {
  const target = resolveMarkdownImage(relPath, src);
  const repoPath = target?.kind === "repo" ? target.path : null;
  const [state, setState] = useState<ImgState>(() =>
    target?.kind === "data"
      ? { kind: "ok", src: target.src }
      : repoPath
        ? { kind: "loading" }
        : { kind: "alt" },
  );

  useEffect(() => {
    if (!repoPath) return;
    let cancelled = false;
    window.airlock
      .readImageDataUrl(root, repoPath)
      .then((r) => {
        if (!cancelled)
          setState(
            r.tooLarge ? { kind: "alt" } : { kind: "ok", src: r.dataUrl },
          );
      })
      .catch(() => {
        if (!cancelled) setState({ kind: "alt" });
      });
    return () => {
      cancelled = true;
    };
  }, [root, repoPath]);

  if (state.kind === "ok")
    return (
      <img
        className="md-img"
        src={state.src}
        alt={alt}
        onError={() => setState({ kind: "alt" })}
      />
    );
  // Loading reserves nothing: images are rare and a placeholder box that
  // resolves 30ms later is its own flicker.
  if (state.kind === "loading" || !alt) return null;
  return (
    <span className="md-img-alt" title={src}>
      {alt}
    </span>
  );
}
