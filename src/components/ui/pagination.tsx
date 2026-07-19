import Link from "next/link";
import clsx from "clsx";

// No "use client" directive — this file has no hooks of its own, so it
// works embedded in either a Server Component (via hrefFor + next/link,
// which RSC supports natively) or a Client Component (via onNavigate).
// Unifies the two pagination idioms that previously existed independently
// (companies-list: server <Link>-driven; search-results: client
// router.push-driven) into one shared visual result.

export function Pagination({
  page,
  pageCount,
  pageSize,
  hrefFor,
  onNavigate,
}: {
  page: number;
  pageCount: number;
  pageSize?: number;
  /** Server-rendered usage: build the href for a target page. */
  hrefFor?: (targetPage: number) => string;
  /** Client usage: handle navigation to a target page directly. */
  onNavigate?: (targetPage: number) => void;
}) {
  if (pageCount <= 1) return null;

  const prevDisabled = page <= 1;
  const nextDisabled = page >= pageCount;
  const base = "rounded-lg border border-border-strong px-4 py-2 text-sm font-semibold text-text";

  function control(direction: "prev" | "next") {
    const disabled = direction === "prev" ? prevDisabled : nextDisabled;
    const targetPage = direction === "prev" ? Math.max(1, page - 1) : Math.min(pageCount, page + 1);
    const label = direction === "prev" ? "Previous" : "Next";

    if (hrefFor) {
      return (
        <Link
          href={hrefFor(targetPage)}
          aria-disabled={disabled}
          className={clsx(base, disabled ? "pointer-events-none opacity-40" : "hover:bg-black/5")}
        >
          {label}
        </Link>
      );
    }
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => onNavigate?.(targetPage)}
        className={clsx(base, "disabled:pointer-events-none disabled:opacity-40", !disabled && "hover:bg-black/5")}
      >
        {label}
      </button>
    );
  }

  return (
    <div className="flex items-center justify-between">
      {control("prev")}
      <p className="text-sm text-text-muted">
        Page {page} of {pageCount}
        {pageSize ? ` · ${pageSize} per page` : ""}
      </p>
      {control("next")}
    </div>
  );
}
