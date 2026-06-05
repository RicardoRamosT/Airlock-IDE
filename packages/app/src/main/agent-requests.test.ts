import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type RequestNotifier,
  requestSecretFromUser,
  resolveSecretRequest,
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
