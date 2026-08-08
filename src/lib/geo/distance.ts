import type { DistanceUnit } from "@/generated/prisma/enums";

const METERS_PER_MILE = 1609.34;
const METERS_PER_KILOMETER = 1000;

/**
 * Bounds enforced by PubRadiusSetupSchema and mirrored on the radius input's
 * min/max so the form and the server-side validation never disagree.
 */
export const RADIUS_BOUNDS: Record<DistanceUnit, { min: number; max: number }> = {
  MI: { min: 1, max: 50 },
  KM: { min: 1, max: 80 },
};

export function radiusToMeters(value: number, unit: DistanceUnit): number {
  return unit === "MI" ? value * METERS_PER_MILE : value * METERS_PER_KILOMETER;
}
