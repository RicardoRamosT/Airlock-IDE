import { useEffect } from "react";
import { useApp } from "../store";

// Seed the Claude status from main's last reading, then live-update on each
// poll. Mirrors useQuota: subscribe on mount, unsubscribe on unmount.
export function useAnthropicStatus(): void {
  const setAnthropicStatus = useApp((s) => s.setAnthropicStatus);
  useEffect(() => {
    let cancelled = false;
    window.airlock
      .anthropicStatusGet()
      .then((s) => {
        if (!cancelled && s) setAnthropicStatus(s);
      })
      .catch(console.error);
    const off = window.airlock.onAnthropicStatusChanged((s) =>
      setAnthropicStatus(s),
    );
    return () => {
      cancelled = true;
      off();
    };
  }, [setAnthropicStatus]);
}
