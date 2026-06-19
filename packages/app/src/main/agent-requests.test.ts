import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type GrantNotifier,
  gatedTerminalInput,
  type RequestNotifier,
  requestSecretFromUser,
  resolveSecretRequest,
  resolveTerminalGrant,
} from "./agent-requests";

type NotifyPayload = Parameters<RequestNotifier>[0];

// A fake renderer notifier: records every payload it is handed and reports a
// live window (returns true) by default. The "no window" case overrides this to
// return false. Using a fake here is the whole point of the DI seam -- the
// resolver/timeout/busy logic runs with NO Electron.
function makeFakeNotify(result = true) {
  const payloads: NotifyPayload[] = [];
  const notify: RequestNotifier = (p) => {
    payloads.push(p);
    return result;
  };
  return { notify, payloads };
}

// Narrowing accessor: returns the i-th recorded payload, throwing if absent.
// The repo enables noUncheckedIndexedAccess, so direct payloads[i] is possibly
// undefined; this asserts the request was recorded and gives a non-optional type.
function nth(payloads: NotifyPayload[], i: number): NotifyPayload {
  const p = payloads[i];
  if (!p) throw new Error(`expected a recorded payload at index ${i}`);
  return p;
}

type GrantPayload = Parameters<GrantNotifier>[0];

// Same narrowing as nth(), for a mocked GrantNotifier: returns its first
// recorded payload (throwing if absent) so noUncheckedIndexedAccess does not
// flag the direct calls[0][0] access in the terminal-grant tests below.
function firstGrant(
  notify: ReturnType<typeof vi.fn<GrantNotifier>>,
): GrantPayload {
  const call = notify.mock.calls[0];
  if (!call) throw new Error("expected a recorded grant request");
  return call[0];
}

afterEach(() => {
  // Defensive: a test that leaves a pending request (it should not) would make
  // the next one report busy. Real timers are restored per-test where faked.
  vi.useRealTimers();
});

describe("requestSecretFromUser", () => {
  it("notifies the renderer once with a non-empty requestId, name, and providerHint", () => {
    const { notify, payloads } = makeFakeNotify();
    void requestSecretFromUser("API_KEY", "hint", notify);

    expect(payloads).toHaveLength(1);
    expect(nth(payloads, 0).name).toBe("API_KEY");
    expect(nth(payloads, 0).providerHint).toBe("hint");
    expect(typeof nth(payloads, 0).requestId).toBe("string");
    expect(nth(payloads, 0).requestId.length).toBeGreaterThan(0);

    // Clean up the in-flight request so it does not leak into the next test.
    resolveSecretRequest(nth(payloads, 0).requestId, false);
  });

  it("resolves {vaulted:true} when the renderer reports the captured requestId saved", async () => {
    const { notify, payloads } = makeFakeNotify();
    const p = requestSecretFromUser("API_KEY", "hint", notify);

    resolveSecretRequest(nth(payloads, 0).requestId, true);

    await expect(p).resolves.toEqual({ vaulted: true });
  });

  it("resolves {vaulted:false} when the renderer reports cancel", async () => {
    const { notify, payloads } = makeFakeNotify();
    const p = requestSecretFromUser("API_KEY", "hint", notify);

    resolveSecretRequest(nth(payloads, 0).requestId, false);

    await expect(p).resolves.toEqual({ vaulted: false });
  });

  it("rejects a 2nd request while one is pending (busy) without notifying again", async () => {
    const { notify, payloads } = makeFakeNotify();
    const first = requestSecretFromUser("FIRST", undefined, notify);

    const second = await requestSecretFromUser("SECOND", undefined, notify);
    expect(second).toEqual({ vaulted: false, busy: true });
    // The fake was NOT called a 2nd time -- no second modal was opened.
    expect(payloads).toHaveLength(1);
    expect(nth(payloads, 0).name).toBe("FIRST");

    // The first is still resolvable afterward.
    resolveSecretRequest(nth(payloads, 0).requestId, true);
    await expect(first).resolves.toEqual({ vaulted: true });
  });

  it("resolves {vaulted:false} with no window, leaving no stuck pending entry", async () => {
    const { notify: noWindow, payloads } = makeFakeNotify(false);
    await expect(
      requestSecretFromUser("API_KEY", "hint", noWindow),
    ).resolves.toEqual({ vaulted: false });
    expect(payloads).toHaveLength(1);

    // A subsequent request still works (the no-window path left nothing pending),
    // so this one is NOT reported busy and reaches a live fake.
    const { notify: ok, payloads: okPayloads } = makeFakeNotify();
    const p = requestSecretFromUser("NEXT", undefined, ok);
    expect(okPayloads).toHaveLength(1);
    resolveSecretRequest(nth(okPayloads, 0).requestId, true);
    await expect(p).resolves.toEqual({ vaulted: true });
  });

  it("times out to {vaulted:false, timedOut:true} and clears pending for the next request", async () => {
    vi.useFakeTimers();
    const { notify, payloads } = makeFakeNotify();
    const p = requestSecretFromUser("API_KEY", "hint", notify);

    // Advance well past the 5-minute timeout with no resolve.
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1000);
    await expect(p).resolves.toEqual({ vaulted: false, timedOut: true });

    // Pending was cleared by the timeout -- a new request is NOT busy.
    const second = requestSecretFromUser("AGAIN", undefined, notify);
    expect(payloads).toHaveLength(2);
    resolveSecretRequest(nth(payloads, 1).requestId, true);
    await expect(second).resolves.toEqual({ vaulted: true });
  });
});

// grantedTerminals is module state that persists across tests, so each test uses
// a UNIQUE ptyId to avoid cross-test grant leakage.
describe("terminal input grants", () => {
  it("unknown terminal -> error, no prompt, no write", async () => {
    const notify = vi.fn<GrantNotifier>(() => true);
    const write = vi.fn(() => true);
    const r = await gatedTerminalInput("p-unknown", "hi\n", {
      write,
      label: () => null,
      notify,
    });
    expect(r).toEqual({ error: expect.any(String) });
    expect(notify).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it("first send prompts, waits, and on allow writes -> {sent}", async () => {
    const notify = vi.fn<GrantNotifier>(() => true);
    const write = vi.fn(() => true);
    const promise = gatedTerminalInput("p-allow", "fix tests\n", {
      write,
      label: () => "myproj",
      notify,
    });
    expect(notify).toHaveBeenCalledTimes(1);
    const { requestId, label } = firstGrant(notify);
    expect(label).toBe("myproj");
    resolveTerminalGrant(requestId, true);
    expect(await promise).toEqual({ sent: true });
    expect(write).toHaveBeenCalledWith("p-allow", "fix tests\n");
  });

  it("a second send to an already-granted terminal skips the prompt", async () => {
    const notify = vi.fn<GrantNotifier>(() => true);
    const write = vi.fn(() => true);
    const p1 = gatedTerminalInput("p-twice", "a\n", {
      write,
      label: () => "x",
      notify,
    });
    resolveTerminalGrant(firstGrant(notify).requestId, true);
    await p1;
    notify.mockClear();
    const r2 = await gatedTerminalInput("p-twice", "b\n", {
      write,
      label: () => "x",
      notify,
    });
    expect(notify).not.toHaveBeenCalled();
    expect(r2).toEqual({ sent: true });
    expect(write).toHaveBeenLastCalledWith("p-twice", "b\n");
  });

  it("deny -> {denied}, no write", async () => {
    const notify = vi.fn<GrantNotifier>(() => true);
    const write = vi.fn(() => true);
    const promise = gatedTerminalInput("p-deny", "x\n", {
      write,
      label: () => "x",
      notify,
    });
    resolveTerminalGrant(firstGrant(notify).requestId, false);
    expect(await promise).toEqual({ denied: true });
    expect(write).not.toHaveBeenCalled();
  });

  it("a second request while one is pending -> {busy}", async () => {
    const notify = vi.fn<GrantNotifier>(() => true);
    const write = vi.fn(() => true);
    const p1 = gatedTerminalInput("p-busy-1", "x\n", {
      write,
      label: () => "x",
      notify,
    });
    const r2 = await gatedTerminalInput("p-busy-2", "y\n", {
      write,
      label: () => "x",
      notify,
    });
    expect(r2).toEqual({ busy: true });
    resolveTerminalGrant(firstGrant(notify).requestId, false); // cleanup
    await p1;
  });

  it("no live window (notify false) -> {denied}, no write", async () => {
    const notify = vi.fn<GrantNotifier>(() => false);
    const write = vi.fn(() => true);
    const r = await gatedTerminalInput("p-nowin", "x\n", {
      write,
      label: () => "x",
      notify,
    });
    expect(r).toEqual({ denied: true });
    expect(write).not.toHaveBeenCalled();
  });

  it("times out to {timedOut:true} when the grant is never resolved, and does not write", async () => {
    vi.useFakeTimers();
    const notify = vi.fn<GrantNotifier>(() => true);
    const write = vi.fn(() => true);
    const promise = gatedTerminalInput("p-grant-timeout", "x\n", {
      write,
      label: () => "x",
      notify,
    });
    // Advance well past the 5-minute grant timeout with no allow/deny.
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1000);
    expect(await promise).toEqual({ timedOut: true });
    expect(write).not.toHaveBeenCalled();
  });
});

// Both flows share the renderer's single `modal` slot, so an outstanding request
// in EITHER flow must make the OTHER flow report busy (else the second modal
// would clobber the first, stranding the first agent until its timeout). Each
// test uses unique ptyIds/names since grant/secret state is module-level.
describe("cross-flow agent-modal busy guard", () => {
  it("a pending secret request makes a terminal grant for an ungranted pty report busy without notifying", async () => {
    const { notify: secretNotify, payloads } = makeFakeNotify();
    // Leave this secret request pending (do not resolve) -- a modal is open.
    const secret = requestSecretFromUser("X_SECRET", undefined, secretNotify);

    const grantNotify = vi.fn<GrantNotifier>(() => true);
    const write = vi.fn(() => true);
    const r = await gatedTerminalInput("p-cross-1", "y\n", {
      write,
      label: () => "x",
      notify: grantNotify,
    });
    expect(r).toEqual({ busy: true });
    // No second modal was opened, and nothing was written.
    expect(grantNotify).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();

    // Clean up the pending secret request so it does not leak into later tests.
    resolveSecretRequest(nth(payloads, 0).requestId, false);
    await expect(secret).resolves.toEqual({ vaulted: false });
  });

  it("a pending terminal grant makes a secret request report {vaulted:false, busy:true}", async () => {
    const grantNotify = vi.fn<GrantNotifier>(() => true);
    const write = vi.fn(() => true);
    // Leave this grant request pending (do not resolve) -- a modal is open.
    const grant = gatedTerminalInput("p-cross-2", "z\n", {
      write,
      label: () => "x",
      notify: grantNotify,
    });

    const { notify: secretNotify, payloads } = makeFakeNotify();
    const second = await requestSecretFromUser(
      "Y_SECRET",
      undefined,
      secretNotify,
    );
    expect(second).toEqual({ vaulted: false, busy: true });
    // No secret modal was opened.
    expect(payloads).toHaveLength(0);

    // Clean up the pending grant.
    resolveTerminalGrant(firstGrant(grantNotify).requestId, false);
    await expect(grant).resolves.toEqual({ denied: true });
  });

  it("an already-granted pty still resolves immediately even while a secret request is pending", async () => {
    // First, grant the pty via a resolved grant request.
    const grantNotify = vi.fn<GrantNotifier>(() => true);
    const write = vi.fn(() => true);
    const g1 = gatedTerminalInput("p-cross-3", "a\n", {
      write,
      label: () => "x",
      notify: grantNotify,
    });
    resolveTerminalGrant(firstGrant(grantNotify).requestId, true);
    await g1;
    grantNotify.mockClear();

    // Now open (and leave pending) a secret request.
    const { notify: secretNotify, payloads } = makeFakeNotify();
    const secret = requestSecretFromUser("Z_SECRET", undefined, secretNotify);

    // The already-granted pty short-circuits before the busy guard: no notify,
    // resolves {granted:true} (here surfaced as {sent:true} after the write).
    const r2 = await gatedTerminalInput("p-cross-3", "b\n", {
      write,
      label: () => "x",
      notify: grantNotify,
    });
    expect(r2).toEqual({ sent: true });
    expect(grantNotify).not.toHaveBeenCalled();
    expect(write).toHaveBeenLastCalledWith("p-cross-3", "b\n");

    // Clean up the pending secret request.
    resolveSecretRequest(nth(payloads, 0).requestId, false);
    await expect(secret).resolves.toEqual({ vaulted: false });
  });
});
