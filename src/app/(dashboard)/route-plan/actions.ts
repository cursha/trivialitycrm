"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/current-user";
import {
  addCompanyToRoute,
  removeCompanyFromRoute,
  bulkAddCompaniesToRoute,
  clearRoute,
  type AddToRouteResult,
  type BulkAddResult,
} from "@/lib/route-plan/service";

// Revalidated on every mutating action, not just the Route Plan page
// itself — the header's Route Plan (N) badge is rendered from the
// dashboard layout, which wraps every page, so any page the user is
// currently on needs its count refreshed too (e.g. adding from a company
// profile updates the badge without navigating away).
const ROUTE_PLAN_PATH = "/route-plan";

export async function addToRoute(companyId: string): Promise<AddToRouteResult> {
  const user = await requireUser();
  const result = await addCompanyToRoute(user, companyId);
  if (result.ok) {
    revalidatePath(ROUTE_PLAN_PATH);
    revalidatePath("/companies");
    revalidatePath(`/companies/${companyId}`);
  }
  return result;
}

export async function removeFromRoute(companyId: string): Promise<{ count: number }> {
  const user = await requireUser();
  const result = await removeCompanyFromRoute(user, companyId);
  revalidatePath(ROUTE_PLAN_PATH);
  revalidatePath("/companies");
  revalidatePath(`/companies/${companyId}`);
  return result;
}

export async function bulkAddToRoute(companyIds: string[]): Promise<BulkAddResult> {
  const user = await requireUser();
  const result = await bulkAddCompaniesToRoute(user, companyIds);
  revalidatePath(ROUTE_PLAN_PATH);
  revalidatePath("/companies");
  return result;
}

export async function clearRouteAction(): Promise<void> {
  const user = await requireUser();
  await clearRoute(user);
  revalidatePath(ROUTE_PLAN_PATH);
  revalidatePath("/companies");
}
