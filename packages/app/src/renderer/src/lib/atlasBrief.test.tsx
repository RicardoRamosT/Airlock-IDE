// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { renderBrief } from "./atlasBrief";

afterEach(cleanup);

const show = (md: string) => render(<div>{renderBrief(md)}</div>);

it("renders an ATX heading as a heading, not as literal hashes", () => {
  // Observed in the real chat: "## Two loose ends attached to Etapa 4" came out
  // with the hashes visible. Atlas writes these unprompted, so the renderer has
  // to handle them or it leaks raw markdown -- the thing it exists to prevent.
  const { container } = show("## Two loose ends\nbody text");
  expect(screen.queryByText(/^##/)).toBeNull();
  const head = container.querySelector(".atlas-brief-heading");
  expect(head?.textContent).toBe("Two loose ends");
});

it("handles every heading level, and closing hashes", () => {
  const { container } = show("# One\n### Three\n## Closed ##");
  const heads = [...container.querySelectorAll(".atlas-brief-heading")];
  expect(heads.map((h) => h.textContent)).toEqual(["One", "Three", "Closed"]);
});

it("still renders bold-only lines as headings", () => {
  const { container } = show("**Yesterday**");
  expect(container.querySelector(".atlas-brief-heading")?.textContent).toBe(
    "Yesterday",
  );
});

it("does not mistake a bullet or a hash inside text for a heading", () => {
  const { container } = show("- a bullet\nissue #42 is open");
  expect(container.querySelector(".atlas-brief-heading")).toBeNull();
  expect(container.querySelector(".atlas-brief-item")?.textContent).toBe(
    "a bullet",
  );
});

it("renders inline bold and code inside a heading", () => {
  const { container } = show("## The `run` step is **done**");
  const head = container.querySelector(".atlas-brief-heading");
  expect(head?.querySelector("code")?.textContent).toBe("run");
  expect(head?.querySelector("strong")?.textContent).toBe("done");
});
