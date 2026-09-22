import { useEffect, useState } from "react";
import type { SpineDot } from "../../../shared/ipc";

// The dots, as main last pushed them.
//
// Starts empty, which renders no strip at all -- correct, because "no projects
// open" and "not asked yet" both mean there is nothing to show, and neither
// deserves a placeholder in 28px of chrome.
//
// The payload is normalised because it crosses IPC: the spine stack renders
// inside the App tree, so a throw during render would white out the window
// (the same reason useAgentRequests normalises its own).
export function useSpineDots(): SpineDot[] {
  const [dots, setDots] = useState<SpineDot[]>([]);
  useEffect(
    () =>
      window.airlock.onAtlasSpine((next) =>
        setDots(Array.isArray(next) ? next : []),
      ),
    [],
  );
  return dots;
}
