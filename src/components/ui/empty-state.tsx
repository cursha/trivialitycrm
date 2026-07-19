import type { ReactNode } from "react";

/** Standard "nothing here yet" message — replaces ~12 independently
 * hand-written instances of the same `text-sm text-slate-500` sentence. */
export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="py-2 text-sm text-text-muted">{children}</p>;
}
