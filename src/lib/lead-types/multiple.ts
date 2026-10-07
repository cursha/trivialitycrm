import "server-only";
import { prisma } from "../prisma";

/**
 * Whether there's more than one active lead type. With just one (e.g. only
 * "pubs"), lead type is never asked for, filtered on or shown — every form
 * uses the single type automatically — and it all comes back the moment a
 * second lead type is activated.
 */
export async function hasMultipleLeadTypes(): Promise<boolean> {
  return (await prisma.leadType.count({ where: { active: true } })) > 1;
}
