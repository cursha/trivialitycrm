import { PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import type { ITXClientDenyList } from "@prisma/client/runtime/client";

// Relative import (not the `@/` alias) so this module also loads cleanly
// under `tsx` (e.g. prisma/seed.ts), which doesn't resolve tsconfig paths.
// Deliberately no `import "server-only"` guard here for the same reason —
// that marker throws under plain Node/tsx execution. Every consumer of this
// module is itself a server-only context (Server Components/Actions, or the
// seed script), so the omission is safe in practice.

// User.passwordHash is never returned unless a query opts back in with
// `omit: { passwordHash: false }` (login and change-password only). Without
// this, any `include: { user: true }` whose result reached a client
// component shipped the hash to the browser in the page's RSC payload.
function createPrismaClient() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  return new PrismaClient({ adapter, omit: { user: { passwordHash: true } } });
}

/** The app's client type — use this (not the generated `PrismaClient`) in
 * signatures, since the global omit above changes its result types. */
export type AppPrismaClient = ReturnType<typeof createPrismaClient>;
/** The `tx` handed to `prisma.$transaction(async (tx) => …)`; use in place of
 * `Prisma.TransactionClient` for the same reason. */
export type AppTransactionClient = Omit<AppPrismaClient, ITXClientDenyList>;

const globalForPrisma = globalThis as unknown as { prisma?: AppPrismaClient };

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
