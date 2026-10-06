"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/current-user";
import {
  addCompanyToRoute,
  removeCompanyFromRoute,
  bulkAddCompaniesToRoute,
  clearRoute,
  createRoute,
  updateRoute,
  selectRoute,
  deleteRoute,
  type AddToRouteResult,
  type BulkAddResult,
  type RouteMutationResult,
  type RouteTarget,
} from "@/lib/route-plan/service";

// Revalidated on every mutating action, not just the Route Plan page
// itself — the header's Route Plan (N) badge is rendered from the
// dashboard layout, which wraps every page, so any page the user is
// currently on needs its count refreshed too (e.g. adding from a company
// profile updates the badge without navigating away).
const ROUTE_PLAN_PATH = "/route-plan";

function revalidateRoutes(companyId?: string) {
  revalidatePath(ROUTE_PLAN_PATH);
  revalidatePath("/companies");
  revalidatePath("/my-day");
  if (companyId) revalidatePath(`/companies/${companyId}`);
}

/** Adds a company to a chosen route (by id, or a new one), or to the
 * current route when no target is given. */
export async function addToRoute(companyId: string, target?: RouteTarget): Promise<AddToRouteResult> {
  const user = await requireUser();
  const result = await addCompanyToRoute(user, companyId, target);
  if (result.ok) revalidateRoutes(companyId);
  return result;
}

export async function removeFromRoute(companyId: string, routeId?: string): Promise<{ count: number }> {
  const user = await requireUser();
  const result = await removeCompanyFromRoute(user, companyId, routeId);
  revalidateRoutes(companyId);
  return result;
}

export async function createRouteAction(name: string, plannedDate: string | null): Promise<RouteMutationResult> {
  const user = await requireUser();
  const result = await createRoute(user, name, plannedDate);
  revalidateRoutes();
  return result;
}

export async function updateRouteAction(routeId: string, name: string, plannedDate: string | null): Promise<RouteMutationResult> {
  const user = await requireUser();
  const result = await updateRoute(user, routeId, name, plannedDate);
  revalidateRoutes();
  return result;
}

export async function selectRouteAction(routeId: string): Promise<RouteMutationResult> {
  const user = await requireUser();
  const result = await selectRoute(user, routeId);
  revalidateRoutes();
  return result;
}

export async function deleteRouteAction(routeId: string): Promise<RouteMutationResult> {
  const user = await requireUser();
  const result = await deleteRoute(user, routeId);
  revalidateRoutes();
  return result;
}

/** Adds the selected companies to a chosen route (by id, or a new one), or
 * to the current route when no target is given. */
export async function bulkAddToRoute(companyIds: string[], target?: RouteTarget): Promise<BulkAddResult> {
  const user = await requireUser();
  const result = await bulkAddCompaniesToRoute(user, companyIds, target);
  revalidateRoutes();
  return result;
}

export async function clearRouteAction(): Promise<void> {
  const user = await requireUser();
  await clearRoute(user);
  revalidatePath(ROUTE_PLAN_PATH);
  revalidatePath("/companies");
}
