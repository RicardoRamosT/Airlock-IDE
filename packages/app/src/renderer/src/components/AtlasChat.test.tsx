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

let refreshCb: (() => void) | null = null;

let activityCbs: ((i: { tool: string; detail: string }[]) => void)[] = [];
const fireActivity = (items: { tool: string; detail: string }[]) => {
  for (const cb of [...activityCbs]) cb(items);
};

const api = {
  onAtlasRefresh: (cb: () => void) => {
    refreshCb = cb;
    return () => {
      refreshCb = null;
    };
  },
  atlasTurns: vi.fn(
    async () =>
      [] as {
        role: string;
        text: string;
        pending?: "settled" | "pending" | "unanswered";
      }[],
  ),
  onAtlasActivity: (cb: (i: { tool: string; detail: string }[]) => void) => {
    activityCbs.push(cb);
    return () => {
      activityCbs = activityCbs.filter((x) => x !== cb);
    };
  },
  atlasSend: vi.fn(async (_m: string) => ({
    ok: true as const,
    text: "Work on Revaltone-CRM first.",
  })),
  atlasCancel: vi.fn(async () => {}),
};

beforeEach(() => {
  activityCbs = [];
  api.atlasTurns.mockClear();
  api.atlasSend.mockClear();
  api.atlasCancel.mockClear();
  api.atlasTurns.mockResolvedValue([]);
  api.atlasSend.mockResolvedValue({
    ok: true as const,
    text: "Work on Revaltone-CRM first.",
  });
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
  // The third argument is the FOCUS root: null here, because this chat was
  // not opened from a spine dot. A scoped chat passes the project root.
  expect(api.atlasSend).toHaveBeenCalledWith("what should I do?", [], null);
});

it("does not send an empty message", async () => {
  render(<AtlasChat />);
  await waitFor(() => expect(api.atlasTurns).toHaveBeenCalled());
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "   " } });
  fireEvent.submit(form());
  expect(api.atlasSend).not.toHaveBeenCalled();
});

it("shows an error line and keeps the user's turn when the send fails", async () => {
  // null is the CANCELLED/unreachable case, which keeps the generic sentence.
  api.atlasSend.mockResolvedValueOnce(
    null as unknown as { ok: true; text: string },
  );
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
  await waitFor(() =>
    expect(api.atlasSend).toHaveBeenCalledWith("hi", [], null),
  );
});

it("STOPS an in-flight reply on Escape and hands the message back", async () => {
  // A wrong question should not cost a full Opus run. Escape has to kill the
  // subprocess, not merely stop waiting for it -- otherwise it keeps burning
  // quota with nowhere to deliver.
  const held: { settle?: (v: { ok: true; text: string }) => void } = {};
  api.atlasSend.mockImplementationOnce(
    () =>
      new Promise<{ ok: true; text: string }>((r) => {
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
  held.settle?.({ ok: true, text: "a reply nobody wants" });
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

it("clears a stale working indicator when the run finishes elsewhere", async () => {
  // The bug, reported with a screenshot: a panel that loaded a PENDING turn
  // showed "Atlas is working on this..." forever. The reply had landed minutes
  // earlier and was in the database -- but nothing told this renderer, because
  // it was not the one that made the call and atlas:refresh only fired when the
  // popover opened.
  api.atlasTurns.mockResolvedValueOnce([
    { role: "user", text: "is it ready?", pending: "pending" },
  ]);
  render(<AtlasChat />);
  await waitFor(() =>
    expect(screen.getByText(/working on this/i)).toBeTruthy(),
  );

  // The run completes in whichever window asked; main tells everyone.
  api.atlasTurns.mockResolvedValueOnce([
    { role: "user", text: "is it ready?", pending: "settled" },
    {
      role: "atlas",
      text: "Verified at c857937, clean tree.",
      pending: "settled",
    },
  ]);
  refreshCb?.();

  await waitFor(() =>
    expect(screen.getByText(/Verified at c857937/)).toBeTruthy(),
  );
  expect(screen.queryByText(/working on this/i)).toBeNull();
});

it("does not refetch while THIS window is mid-send", async () => {
  // The asking window appends its own reply optimistically. Refetching under it
  // would race that append and could show the reply twice.
  // An object holder, not a `let`: TypeScript narrows a `let` assigned only
  // inside a callback to `null` at the call site.
  const held: { settle?: (v: { ok: true; text: string }) => void } = {};
  api.atlasSend.mockImplementationOnce(
    () =>
      new Promise<{ ok: true; text: string }>((r) => {
        held.settle = r;
      }),
  );
  render(<AtlasChat />);
  await waitFor(() => expect(api.atlasTurns).toHaveBeenCalledTimes(1));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "q" } });
  fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
  await waitFor(() => expect(api.atlasSend).toHaveBeenCalled());

  refreshCb?.();
  await new Promise((r) => setTimeout(r, 20));
  expect(api.atlasTurns).toHaveBeenCalledTimes(1); // no refetch while busy

  held.settle?.({ ok: true, text: "done" });
  await waitFor(() => expect(screen.getByText("done")).toBeTruthy());
});

it("copies a whole message, markdown source and all", async () => {
  // The RAW text, not the rendered DOM: Atlas writes markdown and the point of
  // copying is usually to paste it somewhere that understands it.
  const written: string[] = [];
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: async (t: string) => void written.push(t) },
  });
  api.atlasTurns.mockResolvedValueOnce([
    { role: "atlas", text: "## Heading\n\n- **bold** point" },
  ]);
  render(<AtlasChat />);
  await waitFor(() => expect(screen.getByText("Heading")).toBeTruthy());
  screen.getByRole("button", { name: /copy/i }).click();
  await waitFor(() =>
    expect(written).toEqual(["## Heading\n\n- **bold** point"]),
  );
});

it("confirms the copy so the click is not silent", async () => {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: async () => {} },
  });
  api.atlasTurns.mockResolvedValueOnce([{ role: "atlas", text: "hello" }]);
  render(<AtlasChat />);
  await waitFor(() => expect(screen.getByText("hello")).toBeTruthy());
  screen.getByRole("button", { name: /copy/i }).click();
  // The confirmation is the button itself: its glyph flips to a check and its
  // accessible name to "Copied". It used to be the visible word "Copied", but
  // the action moved under the message as an icon, so the ACCESSIBLE NAME is
  // where the confirmation now lives -- and asserting the name rather than the
  // glyph is what keeps this about the user being told, not about an <i>.
  await waitFor(() =>
    expect(screen.getByRole("button", { name: /^copied$/i })).toBeTruthy(),
  );
});

it("offers copy on the user's own messages too", async () => {
  api.atlasTurns.mockResolvedValueOnce([
    { role: "user", text: "my question" },
    { role: "atlas", text: "the answer" },
  ]);
  render(<AtlasChat />);
  await waitFor(() => expect(screen.getByText("my question")).toBeTruthy());
  expect(screen.getAllByRole("button", { name: /copy/i })).toHaveLength(2);
});

it("shows the REAL reason a run failed, not a blanket network excuse", async () => {
  // On 2026-08-31 a run was killed after fifteen minutes of genuine work and
  // the card said "Could not reach Claude". Claude had been reached and had
  // worked the whole time; main knew exactly why and kept it to the event log,
  // so the only way to find out was to go read the log.
  api.atlasSend.mockResolvedValueOnce({
    ok: false,
    error: "claude produced no output for 5 minutes and was stopped",
  } as unknown as { ok: true; text: string });
  render(<AtlasChat />);
  await waitFor(() => expect(api.atlasTurns).toHaveBeenCalled());
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "hi" } });
  fireEvent.submit(form());
  await waitFor(() =>
    expect(screen.getByText(/produced no output for 5 minutes/i)).toBeTruthy(),
  );
  expect(screen.queryByText(/could not reach/i)).toBeNull();
  // The question is still recoverable either way.
  expect(screen.getByText(/still here/i)).toBeTruthy();
});

it("shows what Atlas is DOING while it thinks, on demand", async () => {
  // A spinner and a timer cannot answer "is it stuck?", which is the only
  // question a long run raises -- and the run killed at 15 minutes on
  // 2026-08-31 was working the entire time with no way to see it.
  const held: { settle?: (v: { ok: true; text: string }) => void } = {};
  api.atlasSend.mockImplementationOnce(
    () =>
      new Promise<{ ok: true; text: string }>((r) => {
        held.settle = r;
      }),
  );
  render(<AtlasChat />);
  await waitFor(() => expect(api.atlasTurns).toHaveBeenCalled());
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "go" } });
  fireEvent.submit(form());
  await waitFor(() => expect(api.atlasSend).toHaveBeenCalled());

  fireActivity([{ tool: "Bash", detail: "git status" }]);
  fireActivity([{ tool: "Read", detail: "/p/app/src/main.ts" }]);

  // Collapsed by default: a count, and the CURRENT step rather than "Thinking".
  const toggle = await screen.findByRole("button", { name: /2 steps/ });
  expect(screen.getByText("Read")).toBeTruthy();
  expect(screen.queryByText("git status")).toBeNull();

  toggle.click();
  await waitFor(() => expect(screen.getByText("git status")).toBeTruthy());
  expect(screen.getByText("/p/app/src/main.ts")).toBeTruthy();

  held.settle?.({ ok: true, text: "done" });
});

it("does not carry one run's steps into the next question", async () => {
  // Asserting the step is simply absent would pass for the wrong reason -- the
  // panel is collapsed by default. So EXPAND it, see the step, then send again
  // and require it to be gone from an open panel.
  const held: { settle?: (v: { ok: true; text: string }) => void } = {};
  api.atlasSend.mockImplementationOnce(
    () =>
      new Promise<{ ok: true; text: string }>((r) => {
        held.settle = r;
      }),
  );
  render(<AtlasChat />);
  await waitFor(() => expect(api.atlasTurns).toHaveBeenCalled());
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "a" } });
  fireEvent.submit(form());
  await waitFor(() => expect(api.atlasSend).toHaveBeenCalled());
  fireActivity([{ tool: "Bash", detail: "stale-step" }]);
  (await screen.findByRole("button", { name: /1 step/ })).click();
  await waitFor(() => expect(screen.getByText("stale-step")).toBeTruthy());

  held.settle?.({ ok: true, text: "first done" });
  await waitFor(() => expect(screen.getByText("first done")).toBeTruthy());

  // Second question, ALSO held open: if it resolved immediately the panel
  // would unmount because the run ended, and the assertion below would pass
  // whether or not the steps were actually cleared.
  const held2: { settle?: (v: { ok: true; text: string }) => void } = {};
  api.atlasSend.mockImplementationOnce(
    () =>
      new Promise<{ ok: true; text: string }>((r) => {
        held2.settle = r;
      }),
  );
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "b" } });
  fireEvent.submit(form());
  await waitFor(() => expect(api.atlasSend).toHaveBeenCalledTimes(2));
  // The panel is open and the run is live, so a surviving step WOULD show.
  fireActivity([{ tool: "Grep", detail: "fresh-step" }]);
  await waitFor(() => expect(screen.getByText("fresh-step")).toBeTruthy());
  expect(screen.queryByText("stale-step")).toBeNull();
  held2.settle?.({ ok: true, text: "second done" });
});
