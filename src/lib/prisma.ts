import { PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Relative import (not the `@/` alias) so this module also loads cleanly
// under `tsx` (e.g. prisma/seed.ts), which doesn't resolve tsconfig paths.
// Deliberately no `import "server-only"` guard here for the same reason —
// that marker throws under plain Node/tsx execution. Every consumer of this
// module is itself a server-only context (Server Components/Actions, or the
// seed script), so the omission is safe in practice.

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createPrismaClient() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
