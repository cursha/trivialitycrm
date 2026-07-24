"use client";

import { createContext, useCallback, useContext, useRef } from "react";

type QuickActionContextValue = {
  registerActivityHandler: (fn: (type: string) => void) => () => void;
  registerFollowUpHandler: (fn: () => void) => () => void;
  requestActivity: (type: string) => void;
  requestFollowUp: () => void;
};

const QuickActionContext = createContext<QuickActionContextValue | null>(null);

function scrollToPanel(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

/** Lets the company detail page's quick-actions bar drive the (separately
 * rendered) activity and follow-up panels below it — one click both scrolls
 * to and pre-fills the right form, instead of only anchor-scrolling.
 * Panels register a handler via a ref (not React state), so the click that
 * triggers a form to open updates that panel's own state from an event
 * handler, never synchronously inside an effect. */
export function QuickActionProvider({ children }: { children: React.ReactNode }) {
  const activityHandlerRef = useRef<((type: string) => void) | null>(null);
  const followUpHandlerRef = useRef<(() => void) | null>(null);

  const registerActivityHandler = useCallback((fn: (type: string) => void) => {
    activityHandlerRef.current = fn;
    return () => {
      if (activityHandlerRef.current === fn) activityHandlerRef.current = null;
    };
  }, []);

  const registerFollowUpHandler = useCallback((fn: () => void) => {
    followUpHandlerRef.current = fn;
    return () => {
      if (followUpHandlerRef.current === fn) followUpHandlerRef.current = null;
    };
  }, []);

  const requestActivity = useCallback((type: string) => {
    activityHandlerRef.current?.(type);
    scrollToPanel("activity-panel");
  }, []);

  const requestFollowUp = useCallback(() => {
    followUpHandlerRef.current?.();
    scrollToPanel("tasks-panel");
  }, []);

  return (
    <QuickActionContext.Provider
      value={{ registerActivityHandler, registerFollowUpHandler, requestActivity, requestFollowUp }}
    >
      {children}
    </QuickActionContext.Provider>
  );
}

export function useQuickActions() {
  const ctx = useContext(QuickActionContext);
  if (!ctx) throw new Error("useQuickActions must be used within a QuickActionProvider");
  return ctx;
}
