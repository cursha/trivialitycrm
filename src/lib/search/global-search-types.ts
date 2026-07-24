// Module Ten: the client-safe half of global search — just the constant and
// types the client component (src/components/global-search.tsx) needs.
// Deliberately split from global-search.ts, which imports prisma at module
// scope: importing even a single named value from a module also containing
// a top-level `import { prisma } from "../prisma"` pulls that entire module
// (Prisma, pg, and pg's Node-builtin requires like "tls") into the client
// bundle, since ESM doesn't tree-shake away a sibling module-scope import
// just because the client only uses one export. Confirmed the hard way — an
// actual `npm run build` failed with "Module not found: Can't resolve
// 'tls'" tracing straight back to this file before the split existed.

export const MIN_QUERY_LENGTH = 2;

export type GlobalSearchResult =
  | { type: "company"; id: string; title: string; subtitle: string; href: string }
  | { type: "contact"; id: string; title: string; subtitle: string; href: string }
  | { type: "competitor"; id: string; title: string; subtitle: string; href: string };

export type GlobalSearchResults = {
  companies: GlobalSearchResult[];
  contacts: GlobalSearchResult[];
  competitors: GlobalSearchResult[];
};
