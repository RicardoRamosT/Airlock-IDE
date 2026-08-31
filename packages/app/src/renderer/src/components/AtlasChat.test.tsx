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
  atlasTurns: vi.fn(
    async () =>
      [] as {
        role: string;
        text: string;
        pending?: "settled" | "pending" | "unanswered";
      }[],
  ),
  atlasSend: vi.fn(async (_m: string) => "Work on Revaltone-CRM first."),
  atlasCancel: vi.fn(async () => {}),
};

beforeEach(() => {
  api.atlasTurns.mockClear();
  api.atlasSend.mockClear();
  api.atlasCancel.mockClear();
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

it("refetches when the host switches conversation", async () => {
  // The bug this pins: reloadKey was accepted as a prop and never placed in
  // the effect's dependency array, so New chat and resuming from History both
  // appeared to do nothing -- the transcript never reloaded.
  api.atlasTurns.mockResolvedValueOnce([{ role: "user", text: "old chat" }]);
  const { rerender } = render(<AtlasChat reloadKey={0} />);
  await waitFor(() => expect(screen.getByText("old chat")).toBeTruthy());

  api.atlasTurns.mockResolvedValueOnce([{ role: "user", text: "new chat" }]);
  rerender(<AtlasChat reloadKey={1} />);
  await waitFor(() => expect(screen.getByText("new chat")).toBeTruthy());
  expect(screen.queryByText("old chat")).toBeNull();
  expect(api.atlasTurns).toHaveBeenCalledTimes(2);
});

it("does not refetch when unrelated props stay the same", async () => {
  render(<AtlasChat reloadKey={3} />);
  await waitFor(() => expect(api.atlasTurns).toHaveBeenCalledTimes(1));
});

const box = () => screen.getByRole("textbox") as HTMLTextAreaElement;

it("does NOT send on Shift+Enter, leaving the newline to be typed", async () => {
  render(<AtlasChat />);
  await waitFor(() => expect(api.atlasTurns).toHaveBeenCalled());
  fireEvent.change(box(), { target: { value: "line one" } });
  fireEvent.keyDown(box(), { key: "Enter", shiftKey: true });
  expect(api.atlasSend).not.toHaveBeenCalled();
  // The draft survives: Shift+Enter is composing, not sending.
  expect(box().value).toBe("line one");
});

it("sends on a plain Enter", async () => {
  render(<AtlasChat />);
  await waitFor(() => expect(api.atlasTurns).toHaveBeenCalled());
  fireEvent.change(box(), { target: { value: "hi" } });
  fireEvent.keyDown(box(), { key: "Enter" });
  await waitFor(() => expect(api.atlasSend).toHaveBeenCalledWith("hi"));
});

it("STOPS an in-flight reply on Escape and hands the message back", async () => {
  // A wrong question should not cost a full Opus run. Escape has to kill the
  // subprocess, not merely stop waiting for it -- otherwise it keeps burning
  // quota with nowhere to deliver.
  const held: { settle?: (v: string) => void } = {};
  api.atlasSend.mockImplementationOnce(
    () =>
      new Promise<string>((r) => {
        held.settle = r;
      }),
  );
  render(<AtlasChat />);
  await waitFor(() => expect(api.atlasTurns).toHaveBeenCalled());
  fireEvent.change(box(), { target: { value: "wrong question" } });
  fireEvent.keyDown(box(), { key: "Enter" });
  await waitFor(() => expect(screen.getByText(/portfolio/i)).toBeTruthy());

  fireEvent.keyDown(box(), { key: "Escape" });
  await waitFor(() => expect(api.atlasCancel).toHaveBeenCalled());
  // The thinking indicator is gone.
  expect(screen.queryByText(/portfolio|thinking/i)).toBeNull();
  // The message comes BACK, so it can be edited and resent rather than retyped.
  expect(box().value).toBe("wrong question");

  // A late result from the killed call must not then claim a failure, nor
  // append a reply the user stopped.
  held.settle?.("a reply nobody wants");
  await waitFor(() =>
    expect(screen.queryByText(/could not reach/i)).toBeNull(),
  );
  expect(screen.queryByText("a reply nobody wants")).toBeNull();
});

it("does nothing on Escape when nothing is in flight", async () => {
  render(<AtlasChat />);
  await waitFor(() => expect(api.atlasTurns).toHaveBeenCalled());
  fireEvent.change(box(), { target: { value: "keep me" } });
  fireEvent.keyDown(box(), { key: "Escape" });
  expect(api.atlasCancel).not.toHaveBeenCalled();
  expect(box().value).toBe("keep me");
});

it("says the transcript could not be LOADED, not that there is none", async () => {
  // Three states were not enough. A rejected read left turns=[] and rendered
  // the empty-conversation prompt -- so a database hiccup told the user their
  // conversation had been deleted. The db is its own process now and is allowed
  // to die, so this is a state the user will actually meet.
  api.atlasTurns.mockRejectedValueOnce(new Error("atlas db host exited (5)"));
  render(<AtlasChat />);
  await waitFor(() => expect(screen.getByText(/could not load/i)).toBeTruthy());
  expect(screen.queryByText(/ask about your projects/i)).toBeNull();
  // And it says the history is still there, because it is.
  expect(screen.getByText(/nothing has been deleted/i)).toBeTruthy();
});

it("recovers when a retry succeeds", async () => {
  api.atlasTurns.mockRejectedValueOnce(new Error("boom"));
  render(<AtlasChat />);
  await waitFor(() => expect(screen.getByText(/could not load/i)).toBeTruthy());
  api.atlasTurns.mockResolvedValueOnce([{ role: "user", text: "still here" }]);
  screen.getByRole("button", { name: /try again/i }).click();
  await waitFor(() => expect(screen.getByText("still here")).toBeTruthy());
  expect(screen.queryByText(/could not load/i)).toBeNull();
});

it("shows an in-flight question with a working indicator after a reopen", async () => {
  // The reported bug: close the panel mid-run and the message was gone, because
  // it lived only in this component's state. It is persisted now, so a reopen
  // must show it AND show that Atlas is still on it -- `busy` died with the old
  // renderer, so the indicator has to come from the turn itself.
  api.atlasTurns.mockResolvedValueOnce([
    { role: "user", text: "what should I do?", pending: "pending" },
  ]);
  render(<AtlasChat />);
  await waitFor(() =>
    expect(screen.getByText("what should I do?")).toBeTruthy(),
  );
  expect(screen.getByText(/working on this/i)).toBeTruthy();
});

it("says a question was never answered when the run was interrupted", async () => {
  // Quitting AirLock mid-reply used to lose the message entirely. Now it says
  // what happened, which is both true and better than silence.
  api.atlasTurns.mockResolvedValueOnce([
    { role: "user", text: "big question", pending: "unanswered" },
  ]);
  render(<AtlasChat />);
  await waitFor(() => expect(screen.getByText("big question")).toBeTruthy());
  expect(screen.getByText(/never answered|interrupted/i)).toBeTruthy();
});
