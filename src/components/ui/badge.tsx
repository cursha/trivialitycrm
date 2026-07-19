import type { HTMLAttributes } from "react";
import clsx from "clsx";
import { BADGE_TONE_CLASSES, type BadgeTone } from "@/lib/ui/status-tones";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone: BadgeTone;
}

export function Badge({ tone, className, ...props }: BadgeProps) {
  return (
    <span
      className={clsx("inline-block rounded-full px-2.5 py-1 text-xs font-semibold", BADGE_TONE_CLASSES[tone], className)}
      {...props}
    />
  );
}
