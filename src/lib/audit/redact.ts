// Pure redaction pass, reused by both the audit viewer's render path and
// the CSV export (src/app/(dashboard)/administration/audit-log/) so
// redaction can never be forgotten in one but not the other. Mirrors the
// spirit of src/lib/logger.ts's pino `redact.paths` convention, but
// implemented as a plain function since audit rows are rendered in React
// and serialized to CSV, not logged through pino.
const SENSITIVE_KEY_PATTERN = /password|passwordhash|tokenhash|token|apikey|api_key|secret|connectionstring|cookie|authorization/i;

const REDACTED = "[redacted]";

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key);
}

/**
 * Recursively walks a value (typically a JSON blob from AuditEvent's
 * beforeData/afterData/metadata columns) and replaces any object value
 * whose key looks sensitive with a fixed placeholder — never returns the
 * original value for a matched key, regardless of its type.
 */
export function redactSensitiveData(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveData(item));
  }
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      result[key] = isSensitiveKey(key) ? REDACTED : redactSensitiveData(nested);
    }
    return result;
  }
  return value;
}
