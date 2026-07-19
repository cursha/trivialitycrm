import type { HTMLAttributes } from "react";
import clsx from "clsx";

export type AlertTone = "info" | "success" | "warning" | "danger";

// success/warning intentionally use Tailwind's stock emerald/amber, not a
// brand color — these are universal semantic states (green=success,
// amber=caution), not brand-identity colors, and the fixed brand palette
// has no green/yellow. danger uses Mayhem Red-Dark, not Mayhem Red, so an
// error banner is never visually confusable with a primary CTA.
const TONE_CLASSES: Record<AlertTone, string> = {
  info: "bg-secondary/10 text-secondary border-secondary/20",
  success: "bg-emerald-50 text-emerald-800 border-emerald-200",
  warning: "bg-amber-50 text-amber-800 border-amber-200",
  danger: "bg-danger/10 text-danger border-danger/20",
};

export interface AlertProps extends HTMLAttributes<HTMLDivElement> {
  tone: AlertTone;
}

export function Alert({ tone, className, ...props }: AlertProps) {
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={clsx("rounded-lg border px-3 py-2 text-sm font-semibold", TONE_CLASSES[tone], className)}
      {...props}
    />
  );
}
