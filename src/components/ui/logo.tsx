import Image from "next/image";
import clsx from "clsx";

// Both source files are genuinely 3919x3919 (perfectly square, verified via
// sharp against the actual PNG — not assumed). The previous inline usage in
// login/page.tsx and dashboard-shell.tsx declared width={142} height={80},
// a 1.775:1 ratio that does not match the source at all. Next/React uses
// those width/height *attributes* (not the file's real pixel dimensions) to
// compute the "auto" side of `h-X w-auto` sizing, so the mismatched ratio
// was reserving a too-wide, too-short box for what's actually a near-square
// mark — the most likely real cause of "the current logo is too small and
// looks out of place." Declaring the true 3919x3919 ratio here fixes that;
// object-contain still guards against any distortion regardless.
const INTRINSIC_SIZE = 3919;

export type LogoSize = "full" | "compact";

const SRC: Record<LogoSize, string> = {
  full: "/triviality-mayhem-logo.png",
  compact: "/triviality-mayhem-logo-circle.png",
};

/**
 * The single source of truth for rendering the Triviality Mayhem logo —
 * replaces two independently duplicated inline <Image> blocks. `size="full"`
 * is the primary wordmark (sidebar header, sign-in page); `size="compact"`
 * is the circular medallion mark, meant for tight spaces (mobile collapsed
 * header) where the full wordmark wouldn't fit legibly. Never crops,
 * stretches, or otherwise modifies the source artwork — only scales it
 * uniformly via object-contain.
 */
export function Logo({
  size = "full",
  className,
  priority,
}: {
  size?: LogoSize;
  className?: string;
  priority?: boolean;
}) {
  return (
    <Image
      src={SRC[size]}
      alt="Triviality Mayhem"
      width={INTRINSIC_SIZE}
      height={INTRINSIC_SIZE}
      className={clsx("w-auto object-contain", className)}
      priority={priority}
    />
  );
}
