import path from "node:path";

// Deliberately loads ONLY .env.test — never .env (the dev database's
// config) — so a test run can never accidentally pick up dev credentials.
try {
  process.loadEnvFile(path.resolve(__dirname, "../../.env.test"));
} catch {
  // Fall through to whatever the environment (e.g. CI) already provides.
}

// Repoint the app's shared Prisma singleton (src/lib/prisma.ts, which reads
// DATABASE_URL) at the test database for the lifetime of this test process
// only, so action/query code under test uses the same connection as the
// test helpers below — without a second connection pool. Nothing on disk
// is touched; .env and .env.test stay fully separate.
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}
