"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";

export type MenuItem = {
  label: string;
  onSelect: () => void;
  tone?: "default" | "danger";
  disabled?: boolean;
};

/** Minimal dropdown menu — click-to-open, click-outside/Escape to close.
 * The one new UI primitive Module Four needs, for per-card quick actions
 * and the saved-view picker; nothing like it existed before. */
export function Menu({
  trigger,
  items,
  align = "end",
}: {
  trigger: ReactNode;
  items: MenuItem[];
  align?: "start" | "end";
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
      >
        {trigger}
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          className={clsx(
            "absolute z-30 mt-1 min-w-[11rem] rounded-lg border border-border-strong bg-surface-raised py-1 shadow-lg",
            align === "end" ? "right-0" : "left-0",
          )}
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              className={clsx(
                "block w-full px-3 py-2 text-left text-sm hover:bg-black/5 disabled:pointer-events-none disabled:opacity-50",
                item.tone === "danger" ? "text-danger" : "text-text",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
