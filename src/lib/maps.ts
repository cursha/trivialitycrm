/**
 * A Google Maps link for a place (Google's Maps URLs: no API key, no cost,
 * opens the Maps app on a phone). The business name goes in with the
 * address so Maps finds the bar itself, not just the street. Address parts
 * can be blank; null when there's no address at all to go on.
 */
export function googleMapsHref(name: string, ...addressParts: (string | null | undefined)[]): string | null {
  const address = addressParts.map((part) => part?.trim()).filter(Boolean).join(", ");
  if (!address) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${name}, ${address}`)}`;
}
