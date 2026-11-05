import { MapPin } from "lucide-react";
import clsx from "clsx";
import { googleMapsHref } from "@/lib/maps";

/** A small "Map" link that opens the place in Google Maps in a new tab.
 * Renders nothing without an address, and never prints. */
export function MapLink({ name, address, className }: { name: string; address: (string | null | undefined)[]; className?: string }) {
  const href = googleMapsHref(name, ...address);
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      title={`Open ${name} in Google Maps`}
      className={clsx("inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap font-semibold text-secondary hover:underline print:hidden", className)}
    >
      <MapPin size={12} aria-hidden="true" />
      Map
    </a>
  );
}
