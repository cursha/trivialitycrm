import { defineConfig, env } from "prisma/config";

// Prisma 7's config loader does not auto-read .env files, so load it
// ourselves. Safe to skip silently when no .env exists (e.g. env vars
// injected directly by the platform/CI).
try {
  process.loadEnvFile();
} catch {
  // no .env file present — assume the environment already has the vars set
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: env("DATABASE_URL"),
  },
  migrations: {
    seed: "tsx prisma/seed.ts",
  },
});
