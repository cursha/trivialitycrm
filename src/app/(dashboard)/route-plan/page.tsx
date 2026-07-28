import { requireUser } from "@/lib/auth/current-user";
import { requirePermission, hasPermission } from "@/lib/auth/permissions";
import { getRouteDetail } from "@/lib/route-plan/service";
import { PageHeader } from "@/components/ui/page-header";
import { RoutePlanView } from "./route-plan-view";

export const metadata = { title: "Route Plan — Triviality CRM" };

export default async function RoutePlanPage() {
  const user = await requireUser();
  requirePermission(user, "view_route_plan");

  const detail = await getRouteDetail(user);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title={detail.route.leadTypeName ? `Route Plan — ${detail.route.leadTypeName}` : "Route Plan"}
        description={
          detail.route.leadTypeName
            ? `${detail.route.count} compan${detail.route.count === 1 ? "y" : "ies"} in ${detail.route.country}.`
            : "Add companies from the Companies list or a company's own profile to start a route."
        }
      />
      <RoutePlanView detail={detail} canManage={hasPermission(user, "manage_route_plan")} canExport={hasPermission(user, "export_route_plan")} />
    </div>
  );
}
