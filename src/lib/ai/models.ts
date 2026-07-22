// Pure constants only — deliberately split out of src/lib/ai/budget.ts so
// client components (e.g. the AI Settings form) can safely import the
// model allowlist without pulling in budget.ts's Prisma-touching code.
// budget.ts has no `import "server-only"` guard (it must stay importable
// from the worker under plain tsx — see its own header comment), so
// nothing would otherwise stop a client bundle from trying to include
// `pg`/Node built-ins transitively — confirmed by an actual `next build`
// failure ("Module not found: Can't resolve 'fs'/'net'/'tls'") before this
// split existed.
export const APPROVED_MODEL_OPTIONS = ["claude-sonnet-5"] as const;
export type ApprovedModel = (typeof APPROVED_MODEL_OPTIONS)[number];
