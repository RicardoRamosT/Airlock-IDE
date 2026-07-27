// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { DocumentData, DocxBlock } from "../../../shared/ipc";
import { DocxViewer } from "./DocxViewer";

afterEach(cleanup);

const page = {
  width: 612,
  margin: { top: 72, right: 72, bottom: 72, left: 72 },
};

function mount(blocks: DocxBlock[], notes: string[] = []) {
  const data: DocumentData = { doc: { blocks, page }, tooLarge: false, notes };
  (window as unknown as { airlock: Record<string, unknown> }).airlock = {
    readDocument: vi.fn(async () => data),
  };
  return render(<DocxViewer root="/proj" relPath="a.docx" />);
}

// The regression this viewer was rewritten for: the previous pipeline ran the
// file through mammoth, which converts semantic styles only. A title that Word
// centres in 18pt blue via direct formatting arrived as <p><strong>, so the
// viewer showed left-aligned black text. These properties must reach the DOM.
const TITLE: DocxBlock = {
  kind: "p",
  align: "center",
  runs: [
    {
      kind: "text",
      text: "Estructuración de la información",
      color: "#1c5cab",
      size: 18,
      bold: true,
      font: "Arial",
    },
  ],
};

it("renders the document's own colour, size, weight and alignment", async () => {
  const { container } = mount([TITLE]);
  const span = (await screen.findByText(
    "Estructuración de la información",
  )) as HTMLElement;
  expect(span.style.color).toBe("rgb(28, 92, 171)");
  expect(span.style.fontSize).toBe("18pt");
  expect(span.style.fontWeight).toBe("700");
  expect(span.style.fontFamily).toContain("Arial");
  const p = container.querySelector(".docx-p") as HTMLElement;
  expect(p.style.textAlign).toBe("center");
});

it("sizes the paper from the document's own page setup", async () => {
  const { container } = mount([TITLE]);
  await waitFor(() =>
    expect(container.querySelector(".docx-page")).not.toBeNull(),
  );
  const paper = container.querySelector(".docx-page") as HTMLElement;
  expect(paper.style.width).toBe("612pt");
  expect(paper.style.paddingLeft).toBe("72pt");
});

it("draws a paragraph bottom border as the rule under the title block", async () => {
  const { container } = mount([{ kind: "p", rule: true, runs: [] }]);
  await waitFor(() =>
    expect(container.querySelector(".docx-rule")).not.toBeNull(),
  );
});

it("keeps an empty paragraph -- it is Word's vertical spacing", async () => {
  const { container } = mount([{ kind: "p", runs: [] }, TITLE]);
  await waitFor(() =>
    expect(container.querySelectorAll(".docx-p")).toHaveLength(2),
  );
});

it("renders a table with its cell shading", async () => {
  const { container } = mount([
    {
      kind: "table",
      rows: [
        {
          cells: [
            {
              shade: "#d9e2f3",
              blocks: [{ kind: "p", runs: [{ kind: "text", text: "Fecha" }] }],
            },
          ],
        },
      ],
    },
  ]);
  // waitFor resolves on a null return (nothing threw), so assert INSIDE it.
  await waitFor(() =>
    expect(container.querySelector(".docx-table td")).not.toBeNull(),
  );
  const cell = container.querySelector(".docx-table td") as HTMLElement;
  expect(cell.style.background).toBe("rgb(217, 226, 243)");
  expect(cell.textContent).toContain("Fecha");
});

it("renders an embedded image at its document size", async () => {
  const { container } = mount([
    {
      kind: "p",
      runs: [
        {
          kind: "image",
          src: "data:image/png;base64,AAAA",
          width: 216,
          alt: "chart",
        },
      ],
    },
  ]);
  await waitFor(() =>
    expect(container.querySelector("img.docx-img")).not.toBeNull(),
  );
  const img = container.querySelector("img.docx-img") as HTMLImageElement;
  expect(img.getAttribute("src")).toBe("data:image/png;base64,AAAA");
  expect(img.style.width).toBe("216pt");
});

it("admits what it could not show instead of hiding it", async () => {
  mount([TITLE], ["Unsupported image format: emf."]);
  expect(
    await screen.findByText(/1 part of this document could not be shown/i),
  ).toBeTruthy();
});

it("offers the too-large notice rather than a blank page", async () => {
  const data: DocumentData = {
    doc: { blocks: [], page },
    tooLarge: true,
    notes: [],
  };
  (window as unknown as { airlock: Record<string, unknown> }).airlock = {
    readDocument: vi.fn(async () => data),
  };
  render(<DocxViewer root="/proj" relPath="a.docx" />);
  expect(await screen.findByText(/too large to preview/i)).toBeTruthy();
});
