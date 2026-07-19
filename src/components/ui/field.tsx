import { forwardRef } from "react";
import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes, LabelHTMLAttributes, HTMLAttributes } from "react";
import clsx from "clsx";

// Shared control styling — one definition, used by Input/Select/Textarea,
// replacing the identical `rounded-lg border border-slate-300 px-3 py-2
// outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100`
// string previously copy-pasted across ~15 forms.
const CONTROL_CLASSES =
  "w-full rounded-lg border border-border-strong bg-surface-raised px-3 py-2 text-sm text-text outline-none " +
  "focus:border-focus focus:ring-4 focus:ring-focus/20 disabled:cursor-not-allowed disabled:opacity-50";

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={clsx("text-sm font-semibold text-text", className)} {...props} />;
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  return <input ref={ref} className={clsx(CONTROL_CLASSES, className)} {...props} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, ...props },
  ref,
) {
  return <select ref={ref} className={clsx(CONTROL_CLASSES, className)} {...props} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...props },
  ref,
) {
  return <textarea ref={ref} className={clsx(CONTROL_CLASSES, className)} {...props} />;
});

export function HelpText({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={clsx("text-xs text-text-muted", className)} {...props} />;
}

/** Danger (Mayhem Red-Dark), not the brand's primary Mayhem Red — errors and
 * primary CTAs need visually distinct reds so a red message is never
 * mistaken for a red button. */
export function FieldError({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={clsx("text-xs font-semibold text-danger", className)} {...props} />;
}
