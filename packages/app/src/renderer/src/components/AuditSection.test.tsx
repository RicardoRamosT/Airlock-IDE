// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useApp } from "../store";
import { AuditSection } from "./AuditSection";

afterEach(cleanup);

function seedRoot(root: string) {
  useApp.setState({
    activeTabId: "t1",
    tabState: { t1: { root } } as never,
  });
}

function stub(read: () => Promise<unknown[]>) {
  const auditRead = vi.fn(read);
  (window as unknown as { airlock: Record<string, unknown> }).airlock = {
    auditRead,
  };
  return auditRead;
}

const ENTRY = {
  // An ISO string, not epoch ms: the row formats it with iso.slice(11, 19).
  ts: "2026-07-27T12:34:56.000Z",
  actor: "user",
  op: "git.commit",
  detail: {},
};

// "no operations yet" is a real and useful answer -- but it used to be shown
// while the read was still in flight, which made it a claim the section had no
// business making. Not-asked-yet is now its own state.
it("does not claim there are no operations while the log is still being read", async () => {
  stub(() => new Promise(() => {}));
  seedRoot("/repo");
  render(<AuditSection />);
  expect(await screen.findByRole("status")).toBeTruthy();
  expect(screen.queryByText("no operations yet")).toBeNull();
});

it("shows the empty answer once the read comes back empty", async () => {
  stub(async () => []);
  seedRoot("/repo");
  render(<AuditSection />);
  expect(await screen.findByText("no operations yet")).toBeTruthy();
  expect(screen.queryByRole("status")).toBeNull();
});

// THE regression guard for the first-load-only rule. This section polls every
// 3s; if a poll reset the state to "not asked yet" the spinner would flash
// forever. The reset is keyed on the ROOT, not on each fetch.
it("does not return to loading when a poll re-reads the log", async () => {
  vi.useFakeTimers();
  try {
    stub(async () => [ENTRY]);
    seedRoot("/repo");
    render(<AuditSection />);
    await act(async () => {});
    expect(screen.queryByRole("status")).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(10000);
    });
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByText("no operations yet")).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});

// A different project IS a new question, so the spinner is right here -- the
// alternative is showing the previous project's audit entries under the new
// project's header until the read lands.
it("returns to loading when the pane switches to another project", async () => {
  let resolve!: (v: unknown[]) => void;
  stub(
    () =>
      new Promise<unknown[]>((r) => {
        resolve = r;
      }),
  );
  seedRoot("/repo-a");
  const { rerender } = render(<AuditSection />);
  await act(async () => {
    resolve([ENTRY]);
  });
  await waitFor(() => expect(screen.queryByRole("status")).toBeNull());

  seedRoot("/repo-b");
  rerender(<AuditSection />);
  expect(await screen.findByRole("status")).toBeTruthy();
});
