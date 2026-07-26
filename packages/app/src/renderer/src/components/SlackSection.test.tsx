// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  it("renders NOTHING when Slack is not connected (the Hub owns connecting)", async () => {
    allowed.mockResolvedValue({ connected: false, channels: [] });
    const { container } = render(<SlackSection />);
    await act(async () => {});
    expect(allowed).toHaveBeenCalled();
    expect(container.textContent).toBe("");
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
    expect(await screen.findByText("#general-airlock")).toBeTruthy();
    expect(screen.getByText("@Ricardo (DM)")).toBeTruthy();
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
    fireEvent.click(await screen.findByText("#general-airlock"));
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
    fireEvent.click(await screen.findByText("#general-airlock"));
    expect(await screen.findByText(/not_in_channel/)).toBeTruthy();
  });

  it("says a channel is empty when it genuinely has no messages", async () => {
    allowed.mockResolvedValue({
      connected: true,
      channels: [{ id: "C1", name: "general-airlock", kind: "public" }],
    });
    read.mockResolvedValue({ channel: "#general-airlock", messages: [] });
    render(<SlackSection />);
    fireEvent.click(await screen.findByText("#general-airlock"));
    expect(await screen.findByText(/No messages/i)).toBeTruthy();
  });
});
