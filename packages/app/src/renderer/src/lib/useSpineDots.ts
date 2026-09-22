import { useEffect, useState } from "react";
import type { SpineDot } from "../../../shared/ipc";

// The dots: a SNAPSHOT on mount, then a subscription.
//
// Both halves are required. Main broadcasts its first dots at startup, before
// any renderer has mounted and subscribed, so subscribing alone left the strip
// empty until the next tick -- a full minute after launch, and again after
// every renderer reload. The agent-request surface states the same rule: the
// snapshot is the half that survives a reload.
//
// The seed still returns one dot per open project with an empty cache, so the
// strip is there from the first paint and only the colours arrive late.
//
// The payload is normalised because it crosses IPC: the strip renders inside
// the App tree, so a throw during render would white out the window.
export function useSpineDots(): SpineDot[] {
  const [dots, setDots] = useState<SpineDot[]>([]);

  useEffect(() => {
    let live = true;
    const take = (next: unknown) => {
      if (live) setDots(Array.isArray(next) ? (next as SpineDot[]) : []);
    };
    void window.airlock.atlasSpine().then(take);
    const off = window.airlock.onAtlasSpine(take);
    return () => {
      live = false;
      off();
    };
  }, []);

  return dots;
}
