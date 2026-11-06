import { normalizeAddressLine } from "./normalize";

/**
 * Location corroboration for duplicate matching, shared by
 * findPotentialDuplicates() (company add/edit, import, research transfer)
 * and scoreCompanyMatch() (data-quality scan, Competition Locator, Pub Lead
 * Finder).
 *
 * A company name or website domain on its own doesn't identify a location:
 * chains (Boston Pizza, Kelseys, Keenan's Irish Pub, St. Louis Bar & Grill)
 * share both across every location. So a name or website match only counts
 * when the two companies are in the same city AND province/state, and
 * their street addresses don't conflict (two different street addresses in
 * the same city are two locations). An exact street address + postal
 * code match counts on its own (Curt's call: duplicates must be checked on
 * address, phone, city and province, not name alone).
 *
 * Phone and email count on their own too, unless both companies have a
 * street address and the addresses differ: a chain's locations can share a
 * central phone line or head-office email, and Curt's call (2026-11-06,
 * 25 Wimpy's locations flagged against the one entered by hand) is that a
 * different street address means a different place.
 */
export type LocationFields = {
  city?: string | null;
  region?: string | null;
  address1?: string | null;
};

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim().toLowerCase().replace(/\s+/g, " ");
  return trimmed ? trimmed : null;
}

/** Both have a city and province/state, and both match. */
export function sameCityAndRegion(a: LocationFields, b: LocationFields): boolean {
  const [aCity, bCity, aRegion, bRegion] = [clean(a.city), clean(b.city), clean(a.region), clean(b.region)];
  return aCity !== null && aRegion !== null && aCity === bCity && aRegion === bRegion;
}

/** Both have a street address and they're different. */
export function streetAddressesConflict(a: LocationFields, b: LocationFields): boolean {
  if (!a.address1?.trim() || !b.address1?.trim()) return false;
  return normalizeAddressLine(a.address1) !== normalizeAddressLine(b.address1);
}

/** Whether a name or website match between these two should count. */
export function locationCorroborates(a: LocationFields, b: LocationFields): boolean {
  return sameCityAndRegion(a, b) && !streetAddressesConflict(a, b);
}
