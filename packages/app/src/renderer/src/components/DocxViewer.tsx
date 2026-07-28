import { type CSSProperties, Fragment, useEffect, useState } from "react";
import type {
  DocumentData,
  DocxBlock,
  DocxInline,
  DocxParagraph,
  DocxTable,
} from "../../../shared/ipc"; // import type only

import { Loading } from "./Loading";

// Draw a Word document as a PAGE: the real colours, alignment, font sizes and
// margins the file specifies, on paper, at the page width Word would use.
//
// It renders light-on-white even in the dark theme, on purpose. The colours in
// a Word file were chosen against white -- this document's #1c5cab headings and
// #52514E subtitles are close to unreadable on the app's near-black panel -- so
// "show the document's colours" and "match the app theme" cannot both hold. The
// page wins, the way a PDF preview does.
//
// Everything drawn here comes from the structured model in agent-core's
// docxModel.ts, which validated it: colours are hex triplets, sizes are clamped
// points, image sources are already data: URIs. There is no HTML string in the
// pipeline, so nothing to inject.

type State =
  | { kind: "loading" }
  | { kind: "ok"; data: DocumentData }
  | { kind: "too-large" }
  | { kind: "error" };

// Word points map 1:1 onto CSS pt, so the model's numbers go straight through
// and the page lands on the geometry Word shows.
const pt = (v: number | undefined) => (v === undefined ? undefined : `${v}pt`);

function runStyle(r: Extract<DocxInline, { kind: "text" }>): CSSProperties {
  const s: CSSProperties = {};
  if (r.color) s.color = r.color;
  if (r.size) s.fontSize = `${r.size}pt`;
  if (r.bold) s.fontWeight = 700;
  if (r.italic) s.fontStyle = "italic";
  if (r.font) s.fontFamily = `"${r.font}", var(--docx-fallback)`;
  if (r.highlight) s.backgroundColor = r.highlight;
  const decor = [r.underline && "underline", r.strike && "line-through"]
    .filter(Boolean)
    .join(" ");
  if (decor) s.textDecoration = decor;
  return s;
}

function Inline({ run }: { run: DocxInline }) {
  if (run.kind === "image") {
    return (
      <img
        className="docx-img"
        src={run.src}
        alt={run.alt ?? ""}
        style={{ width: pt(run.width), height: pt(run.height) }}
      />
    );
  }
  // A soft line break arrives as its own run so it keeps the surrounding
  // formatting; render it as an actual break rather than a stray newline.
  if (run.text === "\n") return <br />;
  const Tag =
    run.vertAlign === "super"
      ? "sup"
      : run.vertAlign === "sub"
        ? "sub"
        : "span";
  return <Tag style={runStyle(run)}>{run.text}</Tag>;
}

function Paragraph({ p }: { p: DocxParagraph }) {
  const style: CSSProperties = {
    textAlign: p.align,
    marginTop: pt(p.spaceBefore),
    marginBottom: pt(p.spaceAfter),
    marginLeft: pt(p.indent),
  };
  const body = p.runs.map((r, i) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: runs have no stable id
    <Inline key={i} run={r} />
  ));
  // An empty paragraph is Word's vertical spacing -- keep it, or the title
  // block collapses against the text below it.
  const content = body.length > 0 ? body : <br />;

  if (p.heading) {
    const H = `h${p.heading}` as "h1";
    return (
      <H className="docx-h" style={style}>
        {content}
      </H>
    );
  }
  if (p.list) {
    return (
      <div
        className={`docx-li docx-li-${p.list.kind}`}
        style={{
          ...style,
          marginLeft: pt((p.indent ?? 0) + 18 * (p.list.level + 1)),
        }}
      >
        {content}
      </div>
    );
  }
  return (
    <p className={p.rule ? "docx-p docx-rule" : "docx-p"} style={style}>
      {content}
    </p>
  );
}

function Table({ t }: { t: DocxTable }) {
  return (
    <table className="docx-table">
      <tbody>
        {t.rows.map((row, ri) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: rows have no stable id
          <tr key={ri}>
            {row.cells.map((c, ci) => {
              const Cell = row.header ? "th" : "td";
              return (
                <Cell
                  // biome-ignore lint/suspicious/noArrayIndexKey: cells have no stable id
                  key={ci}
                  colSpan={c.colSpan}
                  style={{ background: c.shade, width: pt(c.width) }}
                >
                  <Blocks blocks={c.blocks} />
                </Cell>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Blocks({ blocks }: { blocks: DocxBlock[] }) {
  return (
    <>
      {blocks.map((b, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: blocks have no stable id
        <Fragment key={i}>
          {b.kind === "table" ? <Table t={b} /> : <Paragraph p={b} />}
        </Fragment>
      ))}
    </>
  );
}

export function DocxViewer({
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
      .readDocument(root, relPath)
      .then((d) => {
        if (cancelled) return;
        setState(d.tooLarge ? { kind: "too-large" } : { kind: "ok", data: d });
      })
      .catch((err) => {
        console.error("readDocument failed", err);
        if (!cancelled) setState({ kind: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [root, relPath]);

  if (state.kind === "loading")
    return <Loading label="Loading document" size="page" />;
  if (state.kind === "too-large")
    return (
      <div className="viewer-host empty">
        This document is too large to preview here.
      </div>
    );
  if (state.kind === "error")
    return (
      <div className="viewer-host empty">Could not read this document.</div>
    );

  const { doc, notes } = state.data;
  const empty = doc.blocks.length === 0;
  return (
    <div className="viewer-host docx-viewer-host">
      <article
        className="docx-page"
        style={{
          width: pt(doc.page.width),
          paddingTop: pt(doc.page.margin.top),
          paddingRight: pt(doc.page.margin.right),
          paddingBottom: pt(doc.page.margin.bottom),
          paddingLeft: pt(doc.page.margin.left),
        }}
      >
        {empty ? (
          <p className="docx-empty">This document has no readable text.</p>
        ) : (
          <Blocks blocks={doc.blocks} />
        )}
      </article>
      {/* Say what could not be shown rather than quietly rendering a document
          that is missing pieces. Outside the page: it is AirLock talking, not
          part of the document. */}
      {notes.length > 0 && (
        <details className="docx-notes">
          <summary>
            {notes.length} part{notes.length === 1 ? "" : "s"} of this document
            could not be shown
          </summary>
          <ul>
            {notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
