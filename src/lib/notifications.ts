// No `import "server-only"` — pure formatting, safe to import from the
// client-side NotificationBell as well as any future server-rendered page.

/**
 * One human-readable line per NotificationType — the single place every
 * Notification.payload shape is interpreted, so the bell (and any future
 * consumer) never needs its own copy of "what does this payload mean."
 */
export function describeNotification(type: string, payload: Record<string, unknown>): string {
  switch (type) {
    case "DELIVERY_FAILURE": {
      const target = typeof payload.companyName === "string" ? ` to ${payload.companyName}` : "";
      const subject = typeof payload.subject === "string" ? `: "${payload.subject}"` : "";
      return `Email failed to send${target}${subject}.`;
    }
    case "SCHEDULED_EMAIL_FAILED": {
      const subject = typeof payload.subject === "string" ? `: "${payload.subject}"` : "";
      return `Scheduled email failed to send${subject}.`;
    }
    case "SEQUENCE_COMPLETED":
      return "A follow-up sequence finished all its steps.";
    case "SEQUENCE_PAUSED": {
      const reason = typeof payload.reason === "string" ? ` (${payload.reason})` : "";
      return `A follow-up sequence stopped${reason}.`;
    }
    case "NEW_REPLY":
      return "New reply received.";
    case "APPOINTMENT_ACCEPTED":
      return "An appointment invite was accepted.";
    case "APPOINTMENT_DECLINED":
      return "An appointment invite was declined.";
    case "PROVIDER_DISCONNECTED":
      return "Your connected mailbox was disconnected — reconnect it in Settings.";
    case "FOLLOW_UP_DUE":
      return "A follow-up is due.";
    default:
      return "You have a new notification.";
  }
}
