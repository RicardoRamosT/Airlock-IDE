// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AtlasConsent } from "./AtlasConsent";

afterEach(cleanup);

it("shows the disclosure text it was given", () => {
  render(
    <AtlasConsent disclosure="This uses your plan quota." onAccept={vi.fn()} />,
  );
  expect(screen.getByText(/plan quota/i)).toBeTruthy();
});

it("shows a money disclosure verbatim for an API-key user", () => {
  // The wording differs by credential mode and must never be swapped: quota for
  // plan users, money for API users.
  render(
    <AtlasConsent
      disclosure="Atlas will bill your API account."
      onAccept={vi.fn()}
    />,
  );
  expect(screen.getByText(/bill your API account/i)).toBeTruthy();
});

it("calls onAccept when the user turns it on", () => {
  const onAccept = vi.fn();
  render(<AtlasConsent disclosure="x" onAccept={onAccept} />);
  fireEvent.click(screen.getByRole("button", { name: /turn on/i }));
  expect(onAccept).toHaveBeenCalledTimes(1);
});

it("does not accept on its own", async () => {
  const onAccept = vi.fn();
  render(<AtlasConsent disclosure="x" onAccept={onAccept} />);
  await waitFor(() => expect(screen.getByRole("button")).toBeTruthy());
  expect(onAccept).not.toHaveBeenCalled();
});
