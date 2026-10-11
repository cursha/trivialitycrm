/**
 * How a salesperson is shown in tight list columns: their two-letter code
 * (e.g. "CS"), or their name until an administrator gives them one on
 * Settings → Users. Pair with `title={user.name}` so the full name shows on
 * hover.
 */
export function userCode(user: { name: string; initials: string | null }): string {
  return user.initials ?? user.name;
}
