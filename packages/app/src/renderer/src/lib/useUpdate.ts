import { useEffect } from "react";
import { useApp } from "../store";

// Seed the update status + progress from main, then live-update. Mirrors
// useQuota; also subscribes to the apply progress stream.
export function useUpdate(): void {
  const setUpdate = useApp((s) => s.setUpdate);
  const setUpdateProgress = useApp((s) => s.setUpdateProgress);
  useEffect(() => {
    let cancelled = false;
    window.airlock
      .updateGet()
      .then((s) => {
        if (!cancelled && s) setUpdate(s);
      })
      .catch(console.error);
    const offChanged = window.airlock.onUpdateChanged((s) => setUpdate(s));
    const offProgress = window.airlock.onUpdateProgress((p) =>
      setUpdateProgress(p),
    );
    return () => {
      cancelled = true;
      offChanged();
      offProgress();
    };
  }, [setUpdate, setUpdateProgress]);
}
