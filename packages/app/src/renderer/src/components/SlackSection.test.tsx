// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
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
    slackAvatars: async () => ({}),
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

  // users.list already carries the avatar; the parser used to drop it, so every
  // author got a hash-colored initials circle instead of their real picture.
  it("renders the real profile picture, falling back to initials", async () => {
    allowed.mockResolvedValue({
      connected: true,
      channels: [{ id: "C1", name: "general-airlock", kind: "public" }],
    });
    read.mockResolvedValue({
      channel: "#general-airlock",
      messages: [
        {
          ts: "1785047664.3",
          user: "U1",
          userName: "Ricardo",
          text: "a",
          files: [],
        },
        {
          ts: "1785047999.9",
          user: "U2",
          userName: "Nobody",
          text: "b",
          files: [],
        },
      ],
    });
    (
      window as unknown as { airlock: Record<string, unknown> }
    ).airlock.slackAvatars = async () => ({ U1: "data:image/png;base64,AAA" });
    render(<SlackSection />);
    fireEvent.click(await screen.findByText("general-airlock"));
    // U1 has a picture. Queried by tag, not role: alt="" is deliberate (the
    // author's name sits right next to it), which makes it presentational.
    await waitFor(() =>
      expect(
        document.querySelector("img.slack-avatar")?.getAttribute("src"),
      ).toBe("data:image/png;base64,AAA"),
    );
    // ...and U2, who has none, still gets a circle rather than a broken image.
    expect(document.querySelectorAll("img.slack-avatar")).toHaveLength(1);
    expect(document.querySelectorAll("span.slack-avatar")).toHaveLength(1);
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
          files: [],
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
      {
        ts: `${today}.2`,
        user: "U1",
        userName: "Ricardo",
        text: "second",
        files: [],
      },
      {
        ts: `${today - 60}.1`,
        user: "U1",
        userName: "Ricardo",
        text: "first",
        files: [],
      },
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
      {
        ts: `${today}.2`,
        user: "U1",
        userName: "Ricardo",
        text: "second",
        files: [],
      },
      {
        ts: `${today - 60}.1`,
        user: "U1",
        userName: "Ricardo",
        text: "first",
        files: [],
      },
    ]);
    fireEvent.click(await screen.findByText("general-airlock"));
    await screen.findByText("first");
    // Two messages, one author header.
    expect(screen.getAllByText("Ricardo")).toHaveLength(1);
  });

  it("starts a NEW block when the same author writes much later", async () => {
    // The bug: two messages 15h apart on the same day were grouped under one
    // header, so the later one silently inherited the earlier timestamp.
    const today = Math.floor(Date.now() / 1000);
    withMessages([
      {
        ts: `${today}.2`,
        user: "U1",
        userName: "Ricardo",
        text: "hola",
        files: [],
      },
      {
        ts: `${today - 15 * 3600}.1`,
        user: "U1",
        userName: "Ricardo",
        text: "test",
        files: [],
      },
    ]);
    fireEvent.click(await screen.findByText("general-airlock"));
    await screen.findByText("test");
    // Two blocks => the author header appears twice, each with its own time.
    expect(screen.getAllByText("Ricardo")).toHaveLength(2);
    expect(
      document.querySelectorAll(".slack-msg-time").length,
    ).toBeGreaterThanOrEqual(2);
  });

  it("still groups messages written close together", async () => {
    const today = Math.floor(Date.now() / 1000);
    withMessages([
      {
        ts: `${today}.2`,
        user: "U1",
        userName: "Ricardo",
        text: "second",
        files: [],
      },
      {
        ts: `${today - 30}.1`,
        user: "U1",
        userName: "Ricardo",
        text: "first",
        files: [],
      },
    ]);
    fireEvent.click(await screen.findByText("general-airlock"));
    await screen.findByText("first");
    expect(screen.getAllByText("Ricardo")).toHaveLength(1);
  });

  it("starts a new block when the author changes", async () => {
    const today = Math.floor(Date.now() / 1000);
    withMessages([
      {
        ts: `${today}.2`,
        user: "U2",
        userName: "Ana",
        text: "hers",
        files: [],
      },
      {
        ts: `${today - 60}.1`,
        user: "U1",
        userName: "Ricardo",
        text: "his",
        files: [],
      },
    ]);
    fireEvent.click(await screen.findByText("general-airlock"));
    expect(await screen.findByText("Ricardo")).toBeTruthy();
    expect(screen.getByText("Ana")).toBeTruthy();
  });

  it("shows a day separator and renders join notices quietly", async () => {
    const today = Math.floor(Date.now() / 1000);
    withMessages([
      {
        ts: `${today}.1`,
        user: "U1",
        userName: "Ricardo",
        text: "hi",
        files: [],
      },
      {
        ts: `${today - 86400 * 3}.1`,
        user: "U1",
        userName: "Ricardo",
        text: "<@U1> has joined the channel",
        files: [],
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

describe("SlackSection attachments", () => {
  const IMG = {
    id: "F1",
    name: "image.png",
    mimetype: "image/png",
    size: 2048,
    kind: "image",
  };
  function withAttachment(extra: Record<string, unknown> = {}) {
    allowed.mockResolvedValue({
      connected: true,
      channels: [{ id: "C1", name: "general-airlock", kind: "public" }],
    });
    read.mockResolvedValue({
      channel: "#general-airlock",
      messages: [
        {
          ts: `${Math.floor(Date.now() / 1000)}.1`,
          user: "U1",
          userName: "Ricardo",
          text: "",
          files: [IMG],
        },
      ],
    });
    (window as unknown as { airlock: Record<string, unknown> }).airlock = {
      slackAllowedChannels: allowed,
      slackReadChannel: read,
      slackAvatars: async () => ({}),
      ...extra,
    };
    render(<SlackSection />);
  }

  it("renders an attachment as a compact chip, not a blank row", async () => {
    withAttachment();
    fireEvent.click(await screen.findByText("general-airlock"));
    expect(await screen.findByText("image.png")).toBeTruthy();
  });

  it("opens the downloaded file in a tab when the chip is clicked", async () => {
    const slackDownloadFile = vi.fn(async () => ({
      relPath: ".slack-cache/image.png",
    }));
    const readFile = vi.fn(async () => ({ content: "", binary: true }));
    withAttachment({ slackDownloadFile, readFile });
    fireEvent.click(await screen.findByText("general-airlock"));
    fireEvent.click(await screen.findByText("image.png"));
    await waitFor(() =>
      expect(slackDownloadFile).toHaveBeenCalledWith("/repo", "C1", "F1"),
    );
    // The existing editor path is what actually opens the tab.
    await waitFor(() =>
      expect(readFile).toHaveBeenCalledWith("/repo", ".slack-cache/image.png"),
    );
  });

  // The chip once rendered, downloaded, and then died silently because the open
  // was refused and the error swallowed. A dead click must never be silent again.
  it("reports it when the download succeeds but the open fails", async () => {
    const slackDownloadFile = vi.fn(async () => ({
      relPath: ".slack-cache/image.png",
    }));
    const readFile = vi.fn(async () => {
      throw new Error("The .airlock folder is protected");
    });
    withAttachment({ slackDownloadFile, readFile });
    fireEvent.click(await screen.findByText("general-airlock"));
    fireEvent.click(await screen.findByText("image.png"));
    expect(await screen.findByText(/Could not open that file/i)).toBeTruthy();
  });

  it("shows the refusal reason when the download is refused", async () => {
    const slackDownloadFile = vi.fn(async () => ({
      error:
        "Slack needs the files:read permission. Reconnect Slack for this project to enable attachments.",
    }));
    withAttachment({ slackDownloadFile });
    fireEvent.click(await screen.findByText("general-airlock"));
    fireEvent.click(await screen.findByText("image.png"));
    expect(await screen.findByText(/Reconnect Slack/i)).toBeTruthy();
  });
});

// The allow-list modal existed but was reachable ONLY from the empty state, so
// a project with one channel could never be administered again.
it("offers channel management from the toolbar once channels exist", async () => {
  allowed.mockResolvedValue({
    connected: true,
    channels: [{ id: "C1", name: "general-airlock", kind: "public" }],
    workspace: { id: "T1", name: "Airlock" },
  });
  render(<SlackSection />);
  fireEvent.click(await screen.findByTitle("Manage channels"));
  expect(useApp.getState().modal).toBe("slack-channels");
});

it("names the connected workspace and offers to switch", async () => {
  allowed.mockResolvedValue({
    connected: true,
    channels: [{ id: "C1", name: "general-airlock", kind: "public" }],
    workspace: { id: "T1", name: "Airlock" },
  });
  render(<SlackSection />);
  expect(await screen.findByText("Airlock")).toBeTruthy();
  fireEvent.click(screen.getByText("Switch workspace"));
  expect(useApp.getState().modal).toBe("connect-slack");
});

// Showing the wrong workspace confidently is the bug this identity exists to
// prevent, so an unrecorded one must read as unknown.
it("says the workspace is unknown rather than guessing", async () => {
  allowed.mockResolvedValue({
    connected: true,
    channels: [{ id: "C1", name: "general-airlock", kind: "public" }],
  });
  render(<SlackSection />);
  expect(await screen.findByText(/Workspace unknown/i)).toBeTruthy();
});

it("collapses every open thread from the toolbar", async () => {
  allowed.mockResolvedValue({
    connected: true,
    channels: [{ id: "C1", name: "general-airlock", kind: "public" }],
  });
  read.mockResolvedValue({ channel: "#general-airlock", messages: [] });
  render(<SlackSection />);
  fireEvent.click(await screen.findByText("general-airlock"));
  expect(await screen.findByText("No messages yet")).toBeTruthy();
  fireEvent.click(screen.getByTitle("Collapse all"));
  expect(screen.queryByText("No messages yet")).toBeNull();
});
