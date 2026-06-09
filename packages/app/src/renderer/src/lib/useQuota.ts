import { useEffect } from "react";
import { useApp } from "../store";

// Seed the quota meter from main's last-known status, then live-update on every
// emit. Mirrors useFsWatch: subscribe on mount, unsubscribe on unmount.
export function useQuota(): void {
  const setQuota = useApp((s) => s.setQuota);
  useEffect(() => {
    let cancelled = false;
    window.airlock
      .quotaGet()
      .then((s) => {
        if (!cancelled && s) setQuota(s);
      })
      .catch(console.error);
    const off = window.airlock.onQuotaChanged((s) => setQuota(s));
    return () => {
      cancelled = true;
      off();
    };
  }, [setQuota]);
}
