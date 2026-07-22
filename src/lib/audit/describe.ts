// One human-readable line per (module, action) pair — mirrors
// src/lib/notifications.ts's describeNotification() precedent: the single
// place every AuditEvent's shape is interpreted into plain English, so the
// Administration home, audit log viewer, and CSV export never each need
// their own copy of "what does this event mean."
export type AuditEventLike = {
  module: string;
  action: string;
  success: boolean;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: unknown;
};

function metadataString(metadata: unknown, key: string): string | null {
  if (metadata && typeof metadata === "object" && key in (metadata as Record<string, unknown>)) {
    const value = (metadata as Record<string, unknown>)[key];
    return typeof value === "string" ? value : null;
  }
  return null;
}

/**
 * Switches on `action` alone, not `module`+`action` — every action string
 * this app writes is already its own unique, self-namespaced term (e.g.
 * "user.disabled", "ownership.companies_transferred") and never repeats
 * its module name as a further prefix, so concatenating the two would
 * double up (a real bug caught by this file's own unit test: module
 * "ownership" + action "ownership.companies_transferred" must not become
 * the search key "ownership.ownership.companies_transferred").
 */
export function describeAuditEvent(event: AuditEventLike): string {
  const prefix = event.success ? "" : "Blocked: ";

  switch (event.action) {
    case "user.created":
      return `${prefix}A new user account was created.`;
    case "user.role_changed":
      return `${prefix}A user's role was changed.`;
    case "user.team_changed":
      return `${prefix}A user's team was changed.`;
    case "user.disabled":
      return `${prefix}A user account was deactivated.`;
    case "user.enabled":
      return `${prefix}A user account was reactivated.`;
    case "user.password_reset":
      return `${prefix}A user's password was reset by an administrator.`;
    case "user.unlocked":
      return `${prefix}A locked user account was unlocked.`;
    case "user.sessions_revoked":
      return `${prefix}A user's active sessions were revoked.`;
    case "ownership.companies_transferred": {
      const count = metadataString(event.metadata, "companyCount");
      return `${prefix}${count ?? "Some"} companies had their ownership transferred.`;
    }
    case "ownership.tasks_transferred": {
      const count = metadataString(event.metadata, "taskCount");
      return `${prefix}${count ?? "Some"} tasks had their ownership transferred.`;
    }
    case "role.created":
      return `${prefix}A new role was created.`;
    case "role.duplicated":
      return `${prefix}A role was duplicated.`;
    case "role.activated":
      return `${prefix}A role was activated.`;
    case "role.deactivated":
      return `${prefix}A role was deactivated.`;
    case "role.permission_changed":
      return `${prefix}A role's permissions were changed.`;
    case "organization_settings.updated":
      return `${prefix}Organization settings were updated.`;
    case "ai_settings.updated":
      return `${prefix}AI settings were updated.`;
    case "job.retried":
      return `${prefix}A background job was retried.`;
    case "job.cancelled":
      return `${prefix}A background job was cancelled.`;
    case "audit_log.exported":
      return `${prefix}The audit log was exported.`;
    default:
      return `${prefix}${event.module}: ${event.action.replace(/_/g, " ")}.`;
  }
}
