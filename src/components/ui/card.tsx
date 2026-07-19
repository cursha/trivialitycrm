import type { HTMLAttributes } from "react";
import clsx from "clsx";

/** Standard panel/card surface — replaces the
 * `rounded-2xl border border-slate-200 bg-white p-5 shadow-sm` string that
 * was previously copy-pasted independently across ~20 files. */
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={clsx("rounded-2xl border border-border-strong bg-surface-raised p-5 shadow-sm", className)}
      {...props}
    />
  );
}

export function SectionHeading({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={clsx("text-base font-bold text-accent", className)} {...props} />;
}
