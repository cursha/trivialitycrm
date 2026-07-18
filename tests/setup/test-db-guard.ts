/**
 * Refuses to let any destructive test setup run against anything but an
 * unambiguous test database. Tests must never be able to reset, delete, or
 * modify dev or production data — even by misconfiguration.
 */
export function assertTestDatabaseUrl(url: string | undefined): string {
  if (!url) {
    throw new Error(
      "TEST_DATABASE_URL is not set. Tests must run against a dedicated test database — refusing to proceed.",
    );
  }

  let dbName: string;
  try {
    dbName = new URL(url).pathname.replace(/^\//, "");
  } catch {
    throw new Error(`TEST_DATABASE_URL is not a valid connection string: ${url}`);
  }

  if (!/(^|[_-])test($|[_-])/i.test(dbName)) {
    throw new Error(
      `Refusing to run destructive test setup: database name "${dbName}" is not clearly marked as a test ` +
        `database (expected something like "..._test").`,
    );
  }

  return url;
}
