// OverviewMarkdown.tsx
import { resolveOverviewLink } from "../lib/overviewLink";
import {
  type Inline,
  type ListItem,
  parseOverviewMarkdown,
} from "../lib/overviewMarkdown";

function Spans({
  spans,
  onOpenFile,
}: {
  spans: Inline[];
  onOpenFile?: (rootRelPath: string) => void;
}) {
  return (
    <>
      {spans.map((s, i) => {
        switch (s.t) {
          case "text":
            // biome-ignore lint/suspicious/noArrayIndexKey: inline spans in a static markdown block are positionally stable
            return <span key={i}>{s.v}</span>;
          case "strong":
            // biome-ignore lint/suspicious/noArrayIndexKey: inline spans in a static markdown block are positionally stable
            return <strong key={i}>{s.v}</strong>;
          case "em":
            // biome-ignore lint/suspicious/noArrayIndexKey: inline spans in a static markdown block are positionally stable
            return <em key={i}>{s.v}</em>;
          case "code":
            // biome-ignore lint/suspicious/noArrayIndexKey: inline spans in a static markdown block are positionally stable
            return <code key={i}>{s.v}</code>;
          case "link": {
            // Never let a click navigate the renderer (relative hrefs would
            // break the SPA). External links open in the default browser.
            const external = /^https?:\/\//i.test(s.href);
            const handleClick = (
              e: React.MouseEvent<HTMLAnchorElement>,
            ): void => {
              e.preventDefault();
              if (external) {
                window.open(s.href, "_blank", "noopener");
                return;
              }
              // In-repo link -> open the file in the editor (resolved against
              // .airlock/, where overview.md lives). Non-openable -> no-op.
              const rel = resolveOverviewLink(s.href);
              if (rel) onOpenFile?.(rel);
            };
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: inline spans in a static markdown block are positionally stable
              <a key={i} href={s.href} title={s.href} onClick={handleClick}>
                {s.text}
              </a>
            );
          }
          default:
            return null;
        }
      })}
    </>
  );
}

// Recursive list renderer — shared path for ol/ul and any nesting depth.
function RenderList({
  ordered,
  items,
  onOpenFile,
}: {
  ordered: boolean;
  items: ListItem[];
  onOpenFile?: (rootRelPath: string) => void;
}) {
  const children = items.map((item, j) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: list items are positionally stable (static render)
    <li key={j}>
      <Spans spans={item.spans} onOpenFile={onOpenFile} />
      {item.sub && (
        <RenderList
          ordered={item.sub.ordered}
          items={item.sub.items}
          onOpenFile={onOpenFile}
        />
      )}
    </li>
  ));
  return ordered ? <ol>{children}</ol> : <ul>{children}</ul>;
}

export function OverviewMarkdown({
  md,
  onOpenFile,
}: {
  md: string;
  onOpenFile?: (rootRelPath: string) => void;
}) {
  const blocks = parseOverviewMarkdown(md);
  return (
    <div className="overview-md">
      {blocks.map((b, i) => {
        switch (b.t) {
          case "heading": {
            const inner = <Spans spans={b.spans} onOpenFile={onOpenFile} />;
            const l = Math.min(b.level + 1, 6); // tab already owns the H1
            // biome-ignore lint/suspicious/noArrayIndexKey: markdown blocks are positionally stable (static render)
            if (l <= 2) return <h2 key={i}>{inner}</h2>;
            // biome-ignore lint/suspicious/noArrayIndexKey: markdown blocks are positionally stable (static render)
            if (l === 3) return <h3 key={i}>{inner}</h3>;
            // biome-ignore lint/suspicious/noArrayIndexKey: markdown blocks are positionally stable (static render)
            if (l === 4) return <h4 key={i}>{inner}</h4>;
            // biome-ignore lint/suspicious/noArrayIndexKey: markdown blocks are positionally stable (static render)
            if (l === 5) return <h5 key={i}>{inner}</h5>;
            // biome-ignore lint/suspicious/noArrayIndexKey: markdown blocks are positionally stable (static render)
            return <h6 key={i}>{inner}</h6>;
          }
          case "paragraph":
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: markdown blocks are positionally stable (static render)
              <p key={i}>
                <Spans spans={b.spans} onOpenFile={onOpenFile} />
              </p>
            );
          case "list":
            return (
              <RenderList
                // biome-ignore lint/suspicious/noArrayIndexKey: markdown blocks are positionally stable (static render)
                key={i}
                ordered={b.ordered}
                items={b.items}
                onOpenFile={onOpenFile}
              />
            );
          case "code":
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: markdown blocks are positionally stable (static render)
              <pre key={i} className="overview-md-code">
                <code>{b.v}</code>
              </pre>
            );
          case "quote":
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: markdown blocks are positionally stable (static render)
              <blockquote key={i} className="overview-md-quote">
                <Spans spans={b.spans} onOpenFile={onOpenFile} />
              </blockquote>
            );
          case "table":
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: markdown blocks are positionally stable (static render)
              <table key={i} className="overview-md-table">
                <thead>
                  <tr>
                    {b.headers.map((cell, j) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: table headers are positionally stable (static render)
                      <th key={j}>
                        <Spans spans={cell} onOpenFile={onOpenFile} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {b.rows.map((row, j) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: table rows are positionally stable (static render)
                    <tr key={j}>
                      {row.map((cell, k) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: table cells are positionally stable (static render)
                        <td key={k}>
                          <Spans spans={cell} onOpenFile={onOpenFile} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            );
          default:
            return null;
        }
      })}
    </div>
  );
}
