// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SlackAllowedChannel } from "../../../shared/ipc";
import { useApp } from "../store";
import { SlackSection } from "./SlackSection";

const allowed = vi.fn();
const read = vi.fn();

// House pattern (see SlackChannelsModal.test.tsx): drive the REAL store rather
// than mocking it, and stub window.airlock directly.
function withRoot(root: string) {
  const t1 = useApp.getState().activeTabId;
  useApp.setState({
    activeTabId: t1,
    tabState: { ...useApp.getState().tabState, [t1]: { root } as never },
  });
}

beforeEach(() => {
  allowed.mockReset();
  read.mockReset();
  (window as unknown as { airlock: Record<string, unknown> }).airlock = {
    slackAllowedChannels: allowed,
    slackReadChannel: read,
  };
  withRoot("/repo");
});

afterEach(() => {
  cleanup();
  useApp.setState({ modal: null });
});

describe("SlackSection", () => {
  it("offers to connect when Slack is not connected", async () => {
    // As its OWN sidebar section (rather than a guest inside Activity) an empty
    // panel would be a dead end, so this state carries the action.
    allowed.mockResolvedValue({ connected: false, channels: [] });
    render(<SlackSection />);
    fireEvent.click(await screen.findByText(/Connect Slack/i));
    expect(useApp.getState().modal).toBe("connect-slack");
  });

  it("prompts to pick channels when connected but nothing is allow-listed", async () => {
    allowed.mockResolvedValue({ connected: true, channels: [] });
    render(<SlackSection />);
    expect(await screen.findByText(/Pick channels/i)).toBeTruthy();
  });

  it("opens the allow-list modal from that prompt", async () => {
    allowed.mockResolvedValue({ connected: true, channels: [] });
    render(<SlackSection />);
    fireEvent.click(await screen.findByText(/Pick channels/i));
    expect(useApp.getState().modal).toBe("slack-channels");
  });

  it("lists allow-listed channels COLLAPSED, fetching no messages up front", async () => {
    allowed.mockResolvedValue({
      connected: true,
      channels: [
        { id: "C1", name: "general-airlock", kind: "public" },
        { id: "D1", name: "Ricardo (DM)", kind: "im" },
      ],
    });
    render(<SlackSection />);
    expect(await screen.findByText("general-airlock")).toBeTruthy();
    expect(screen.getByText("Ricardo (DM)")).toBeTruthy();
    // Collapsed means no reads -- six channels must not mean six API calls.
    expect(read).not.toHaveBeenCalled();
  });

  it("fetches and shows time, name and text when a channel is expanded", async () => {
    allowed.mockResolvedValue({
      connected: true,
      channels: [{ id: "C1", name: "general-airlock", kind: "public" }],
    });
    read.mockResolvedValue({
      channel: "#general-airlock",
      messages: [
        {
          ts: "1785047664.355179",
          user: "U1",
          userName: "Ricardo",
          text: "test",
        },
      ],
    });
    render(<SlackSection />);
    fireEvent.click(await screen.findByText("general-airlock"));
    expect(await screen.findByText("Ricardo")).toBeTruthy();
    expect(screen.getByText("test")).toBeTruthy();
    expect(read).toHaveBeenCalledWith("/repo", "C1", expect.any(Number));
  });

  it("shows the REASON a channel could not be read, not an empty list", async () => {
    allowed.mockResolvedValue({
      connected: true,
      channels: [{ id: "C1", name: "general-airlock", kind: "public" }],
    });
    read.mockResolvedValue({ error: "Slack refused: not_in_channel" });
    render(<SlackSection />);
    fireEvent.click(await screen.findByText("general-airlock"));
    expect(await screen.findByText(/not_in_channel/)).toBeTruthy();
  });

  it("says a channel is empty when it genuinely has no messages", async () => {
    allowed.mockResolvedValue({
      connected: true,
      channels: [{ id: "C1", name: "general-airlock", kind: "public" }],
    });
    read.mockResolvedValue({ channel: "#general-airlock", messages: [] });
    render(<SlackSection />);
    fireEvent.click(await screen.findByText("general-airlock"));
    expect(await screen.findByText(/No messages/i)).toBeTruthy();
  });
});

describe("SlackSection transcript", () => {
  function withMessages(messages: unknown[]) {
    allowed.mockResolvedValue({
      connected: true,
      channels: [{ id: "C1", name: "general-airlock", kind: "public" }],
    });
    read.mockResolvedValue({ channel: "#general-airlock", messages });
    render(<SlackSection />);
  }

  it("renders oldest-first (Slack returns newest-first)", async () => {
    const today = Math.floor(Date.now() / 1000);
    withMessages([
      { ts: `${today}.2`, user: "U1", userName: "Ricardo", text: "second" },
      { ts: `${today - 60}.1`, user: "U1", userName: "Ricardo", text: "first" },
    ]);
    fireEvent.click(await screen.findByText("general-airlock"));
    const texts = (await screen.findAllByText(/first|second/)).map(
      (n) => n.textContent,
    );
    expect(texts).toEqual(["first", "second"]);
  });

  it("groups consecutive messages from one author under a single name", async () => {
    const today = Math.floor(Date.now() / 1000);
    withMessages([
      { ts: `${today}.2`, user: "U1", userName: "Ricardo", text: "second" },
      { ts: `${today - 60}.1`, user: "U1", userName: "Ricardo", text: "first" },
    ]);
    fireEvent.click(await screen.findByText("general-airlock"));
    await screen.findByText("first");
    // Two messages, one author header.
    expect(screen.getAllByText("Ricardo")).toHaveLength(1);
  });

  it("starts a new block when the author changes", async () => {
    const today = Math.floor(Date.now() / 1000);
    withMessages([
      { ts: `${today}.2`, user: "U2", userName: "Ana", text: "hers" },
      { ts: `${today - 60}.1`, user: "U1", userName: "Ricardo", text: "his" },
    ]);
    fireEvent.click(await screen.findByText("general-airlock"));
    expect(await screen.findByText("Ricardo")).toBeTruthy();
    expect(screen.getByText("Ana")).toBeTruthy();
  });

  it("shows a day separator and renders join notices quietly", async () => {
    const today = Math.floor(Date.now() / 1000);
    withMessages([
      { ts: `${today}.1`, user: "U1", userName: "Ricardo", text: "hi" },
      {
        ts: `${today - 86400 * 3}.1`,
        user: "U1",
        userName: "Ricardo",
        text: "<@U1> has joined the channel",
      },
    ]);
    fireEvent.click(await screen.findByText("general-airlock"));
    expect(await screen.findByText("Today")).toBeTruthy();
    // The join notice renders as a system line, not an authored message block.
    const join = screen.getByText(/has joined the channel/);
    expect(join.className).toContain("slack-system");
  });
});

describe("SlackSection polling", () => {
  // Fake timers are installed only AFTER the initial channel load has settled:
  // findByText waits on timers, so faking them before the first render leaves
  // the query waiting forever.
  async function renderThenFake(channels: SlackAllowedChannel[]) {
    allowed.mockResolvedValue({ connected: true, channels });
    read.mockResolvedValue({ channel: "#general-airlock", messages: [] });
    render(<SlackSection />);
    const head = await screen.findByText("general-airlock");
    vi.useFakeTimers();
    return head;
  }

  async function click(el: HTMLElement) {
    fireEvent.click(el);
    await act(async () => {});
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it("refetches an EXPANDED channel on the interval, and only that one", async () => {
    const head = await renderThenFake([
      { id: "C1", name: "general-airlock", kind: "public" },
      { id: "C2", name: "nuevo-canal", kind: "public" },
    ]);
    await click(head);
    expect(read).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(read).toHaveBeenCalledTimes(2);
    // Only the expanded channel is polled.
    for (const call of read.mock.calls) expect(call[1]).toBe("C1");
  });

  it("stops polling once the channel is collapsed", async () => {
    const head = await renderThenFake([
      { id: "C1", name: "general-airlock", kind: "public" },
    ]);
    await click(head);
    expect(read).toHaveBeenCalledTimes(1);

    await click(head); // collapse
    const after = read.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(read).toHaveBeenCalledTimes(after);
  });
});
