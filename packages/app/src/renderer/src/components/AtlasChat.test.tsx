// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AtlasChat } from "./AtlasChat";

afterEach(cleanup);

const api = {
  atlasTurns: vi.fn(async () => [] as { role: string; text: string }[]),
  atlasSend: vi.fn(async (_m: string) => "Work on Revaltone-CRM first."),
};

beforeEach(() => {
  api.atlasTurns.mockClear();
  api.atlasSend.mockClear();
  api.atlasTurns.mockResolvedValue([]);
  api.atlasSend.mockResolvedValue("Work on Revaltone-CRM first.");
  (window as unknown as { airlock: unknown }).airlock = api;
});

const form = () =>
  screen.getByRole("textbox").closest("form") as HTMLFormElement;

it("shows a loading state before the first fetch resolves", () => {
  // Three states, not two: not-asked-yet is distinct from asked-and-empty.
  render(<AtlasChat />);
  expect(screen.getByText(/loading/i)).toBeTruthy();
});

it("shows an empty-conversation prompt once the fetch returns nothing", async () => {
  render(<AtlasChat />);
  await waitFor(() =>
    expect(screen.getByText(/ask about your projects/i)).toBeTruthy(),
  );
});

it("renders prior turns oldest-first", async () => {
  api.atlasTurns.mockResolvedValueOnce([
    { role: "user", text: "is ezlis alive?" },
    { role: "atlas", text: "Dormant since April." },
  ]);
  render(<AtlasChat />);
  await waitFor(() => expect(screen.getByText("is ezlis alive?")).toBeTruthy());
  expect(screen.getByText("Dormant since April.")).toBeTruthy();
});

it("sends a message and appends both turns", async () => {
  render(<AtlasChat />);
  await waitFor(() => expect(api.atlasTurns).toHaveBeenCalled());
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "what should I do?" },
  });
  fireEvent.submit(form());
  await waitFor(() =>
    expect(screen.getByText("Work on Revaltone-CRM first.")).toBeTruthy(),
  );
  expect(screen.getByText("what should I do?")).toBeTruthy();
  expect(api.atlasSend).toHaveBeenCalledWith("what should I do?");
});

it("does not send an empty message", async () => {
  render(<AtlasChat />);
  await waitFor(() => expect(api.atlasTurns).toHaveBeenCalled());
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "   " } });
  fireEvent.submit(form());
  expect(api.atlasSend).not.toHaveBeenCalled();
});

it("shows an error line and keeps the user's turn when the send fails", async () => {
  api.atlasSend.mockResolvedValueOnce(null as unknown as string);
  render(<AtlasChat />);
  await waitFor(() => expect(api.atlasTurns).toHaveBeenCalled());
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "hi" } });
  fireEvent.submit(form());
  await waitFor(() =>
    expect(screen.getByText(/could not reach/i)).toBeTruthy(),
  );
  expect(screen.getByText("hi")).toBeTruthy();
});
