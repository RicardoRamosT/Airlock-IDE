// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Switch } from "./Switch";

afterEach(cleanup);

it("reports the new value when toggled on and off", () => {
  const onChange = vi.fn();
  const { rerender } = render(
    <Switch label="Enabled" checked={false} onChange={onChange} />,
  );
  fireEvent.click(screen.getByLabelText("Enabled"));
  expect(onChange).toHaveBeenCalledWith(true);

  rerender(<Switch label="Enabled" checked={true} onChange={onChange} />);
  fireEvent.click(screen.getByLabelText("Enabled"));
  expect(onChange).toHaveBeenLastCalledWith(false);
});

it("is a REAL checkbox, so assistive tech and the keyboard get it for free", () => {
  // The reason this is not a <div role="switch">: keeping the native input
  // means Space toggles it, the label targets it, and getByLabelText finds it,
  // none of which had to be reimplemented. The existing extension-pane tests
  // query exactly this way and kept passing through the swap.
  render(<Switch label="Enabled" checked onChange={() => {}} />);
  const input = screen.getByLabelText("Enabled") as HTMLInputElement;
  expect(input.tagName).toBe("INPUT");
  expect(input.type).toBe("checkbox");
  expect(input.checked).toBe(true);
});

it("is reachable by keyboard -- not hidden with display:none", () => {
  // display:none / visibility:hidden would drop it out of the focus order and
  // make the control mouse-only. It is clipped instead, which keeps it
  // focusable, so this asserts it can actually take focus.
  render(<Switch label="Enabled" checked={false} onChange={() => {}} />);
  const input = screen.getByLabelText("Enabled");
  input.focus();
  expect(document.activeElement).toBe(input);
});

it("uses ariaLabel as the accessible name when the visible text is terse", () => {
  // "Enabled" alone is ambiguous once several panes exist; the accessible name
  // says WHICH extension, while the visible label stays short.
  render(
    <Switch
      label="Enabled"
      ariaLabel="Enable Slack"
      checked
      onChange={() => {}}
    />,
  );
  expect(screen.getByLabelText("Enable Slack")).toBeTruthy();
  expect(screen.getByText("Enabled")).toBeTruthy();
});

it("renders the track and thumb as decorative, not as extra labels", () => {
  // Both are aria-hidden so a screen reader announces one control, not a
  // control plus two stray nodes.
  const { container } = render(
    <Switch label="Enabled" checked onChange={() => {}} />,
  );
  const track = container.querySelector(".switch-track");
  expect(track?.getAttribute("aria-hidden")).toBe("true");
  expect(track?.querySelector(".switch-thumb")).not.toBeNull();
});
