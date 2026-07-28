// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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

// The README claims hash-chain auditing. Until this button existed there was no
// way for the person who owns the log to CHECK that claim -- verifyAuditChain
// was a library function with no entry point, which makes the claim decoration.
describe("verify chain", () => {
  function stubVerify(result: { ok: boolean; entries: number }) {
    const auditVerify = vi.fn(async () => result);
    (window as unknown as { airlock: Record<string, unknown> }).airlock = {
      auditRead: vi.fn(async () => [ENTRY]),
      auditVerify,
    };
    return auditVerify;
  }

  it("reports an intact chain, naming how many entries it checked", async () => {
    const verify = stubVerify({ ok: true, entries: 42 });
    seedRoot("/repo");
    render(<AuditSection />);
    fireEvent.click(await screen.findByRole("button", { name: /verify/i }));
    await waitFor(() => expect(verify).toHaveBeenCalledWith("/repo"));
    // The COUNT matters: "valid" over nothing is true and worthless.
    expect(await screen.findByText(/42 entries/)).toBeTruthy();
    expect(screen.getByText(/intact/i)).toBeTruthy();
  });

  it("says plainly when the chain does NOT hold", async () => {
    stubVerify({ ok: false, entries: 7 });
    seedRoot("/repo");
    render(<AuditSection />);
    fireEvent.click(await screen.findByRole("button", { name: /verify/i }));
    expect(await screen.findByText(/tampered|broken|failed/i)).toBeTruthy();
  });

  // An empty log verifies trivially. Saying "intact" there would be technically
  // true and misleading, so it must not read as evidence.
  it("does not present an empty log as proof of anything", async () => {
    stubVerify({ ok: true, entries: 0 });
    seedRoot("/repo");
    render(<AuditSection />);
    fireEvent.click(await screen.findByRole("button", { name: /verify/i }));
    expect(await screen.findByText(/nothing to verify/i)).toBeTruthy();
  });
});

// The toolbar sits ABOVE the empty-log branch on purpose: a fresh project is
// exactly when someone wants to confirm the mechanism works at all, and hiding
// the button there also made the "nothing to verify" wording unreachable.
it("offers the check even when the log is empty", async () => {
  (window as unknown as { airlock: Record<string, unknown> }).airlock = {
    auditRead: vi.fn(async () => []),
    auditVerify: vi.fn(async () => ({ ok: true, entries: 0 })),
  };
  seedRoot("/repo");
  render(<AuditSection />);
  expect(await screen.findByRole("button", { name: /verify/i })).toBeTruthy();
  expect(screen.getByText("no operations yet")).toBeTruthy();
});
