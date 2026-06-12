// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { EditorContextMenu } from "./EditorContextMenu";

afterEach(cleanup);

it("renders the two actions and fires their callbacks", () => {
  const onDefinition = vi.fn();
  const onReferences = vi.fn();
  const onClose = vi.fn();
  render(
    <EditorContextMenu
      x={10}
      y={20}
      onDefinition={onDefinition}
      onReferences={onReferences}
      onClose={onClose}
    />,
  );
  fireEvent.click(screen.getByText("Go to Definition"));
  expect(onDefinition).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByText("Find All References"));
  expect(onReferences).toHaveBeenCalledTimes(1);
});

it("closes when the backdrop is clicked", () => {
  const onClose = vi.fn();
  render(
    <EditorContextMenu
      x={0}
      y={0}
      onDefinition={() => {}}
      onReferences={() => {}}
      onClose={onClose}
    />,
  );
  fireEvent.click(screen.getByLabelText("Close menu"));
  expect(onClose).toHaveBeenCalledTimes(1);
});
