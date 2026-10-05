import { requireUser } from "@/lib/auth/current-user";
import { requirePermission, hasPermission } from "@/lib/auth/permissions";
import { getRouteDetail, listRoutes } from "@/lib/route-plan/service";
import { PageHeader } from "@/components/ui/page-header";
import { RoutePlanView } from "./route-plan-view";
import { RouteSwitcher } from "./route-switcher";
import { formatRouteDate } from "@/lib/route-plan/format";

export const metadata = { title: "Route Plan — Triviality CRM" };

export default async function RoutePlanPage() {
  const user = await requireUser();
  requirePermission(user, "view_route_plan");

  const [detail, routes] = await Promise.all([getRouteDetail(user), listRoutes(user.id)]);
  const canManage = hasPermission(user, "manage_route_plan");
  const routeTitle = detail.route.name ? [detail.route.name, formatRouteDate(detail.route.plannedDate)].filter(Boolean).join(" · ") : null;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title={routeTitle ? `Route Plan: ${routeTitle}` : "Route Plan"}
        description={
          detail.route.leadTypeName
            ? `${detail.route.count} compan${detail.route.count === 1 ? "y" : "ies"} (${detail.route.leadTypeName}) in ${detail.route.country}.`
            : "Keep a route per day or area. Add bars from a company's page, My Day, or the Companies list."
        }
      />
      <RouteSwitcher routes={routes} canManage={canManage} />
      <RoutePlanView detail={detail} canManage={canManage} canExport={hasPermission(user, "export_route_plan")} />
    </div>
  );
}
