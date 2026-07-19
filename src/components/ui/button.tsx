import { forwardRef } from "react";
import type { ButtonHTMLAttributes } from "react";
import clsx from "clsx";

export type ButtonVariant = "primary" | "secondary" | "destructive" | "ghost";

// disabled:pointer-events-none, not just disabled:opacity-50 — without it, a
// disabled button still fires :hover on mouseover, and because :hover and
// :disabled share the same CSS specificity, which one visually "wins" comes
// down to generated stylesheet order, not the order of Tailwind classes in
// this file. pointer-events:none sidesteps that entirely by preventing the
// browser from ever entering the hover state on a disabled element.
const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-primary text-white hover:bg-primary-hover",
  secondary: "border-2 border-secondary bg-transparent text-secondary hover:border-focus hover:bg-focus hover:text-white",
  destructive: "bg-danger text-white hover:brightness-110",
  ghost: "border border-border-strong bg-transparent text-text hover:bg-black/5",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", className, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={clsx(
        "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-bold transition-colors",
        "disabled:pointer-events-none disabled:opacity-50",
        VARIANT_CLASSES[variant],
        className,
      )}
      {...props}
    />
  );
});
