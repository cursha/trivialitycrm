"use client";

import { useEffect } from "react";

/** Warns before an actual browser-level navigation away (tab close, reload,
 * typed URL) while `active` is true. Browsers ignore any custom message and
 * show their own generic confirmation text — that's standard beforeunload
 * behavior, not a bug here. Note this cannot intercept in-app client-side
 * route changes (e.g. clicking a sidebar link) — the App Router has no
 * built-in route-change-blocking hook for that; it only covers the
 * close-tab/reload/type-a-URL cases. */
export function useUnsavedChangesWarning(active: boolean) {
  useEffect(() => {
    if (!active) return;
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [active]);
}
