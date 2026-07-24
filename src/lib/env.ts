import { z } from "zod";

// Relative-import-free but deliberately NOT `import "server-only"` — this
// module is loaded by worker/index.ts under plain tsx (see prisma.ts for the
// same reasoning), not just by the Next.js server.

// `.optional()` alone only treats `undefined` as absent — an env var set to
// the literal empty string (e.g. `.env`'s `AI_API_KEY=""`, the documented
// "leave blank to skip" convention this file's own comments and
// .env.example use elsewhere) is still a string and fails a `.min(1)`
// check underneath it. Normalizing "" -> undefined first makes blank behave
// exactly like unset, for every optional field, not just this one.
const blankToUndefined = (value: unknown) => (value === "" ? undefined : value);

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: z.string().min(1, "is required"),
    // Public base URL of the deployed app (e.g. https://crm.example.com).
    // Used for the CSP/server-actions trusted-origin allowlist — required in
    // production only, since local dev has no fixed origin to pin.
    APP_URL: z.preprocess(blankToUndefined, z.string().url("must be a valid URL").optional()),
    // Next.js encrypts Server Action closures before sending them to the
    // client. Self-hosted/multi-instance deployments must pin this to a
    // stable value (Next's own docs: otherwise each instance/restart may
    // generate its own key) — required in production only, same reasoning
    // as APP_URL.
    NEXT_SERVER_ACTIONS_ENCRYPTION_KEY: z.preprocess(blankToUndefined, z.string().min(1, "must not be empty").optional()),
    // preprocess is required here too (see blankToUndefined's comment above)
    // — without it, an env var set to "" is a defined-but-invalid enum
    // value, not "absent", so .default("mock") never kicks in and the whole
    // app crash-loops at boot instead of falling back safely. Confirmed
    // live: this exact gap took production down (Railway's AI_PROVIDER was
    // blank, not unset).
    AI_PROVIDER: z.preprocess(blankToUndefined, z.enum(["mock", "anthropic"]).default("mock")),
    AI_API_KEY: z.preprocess(blankToUndefined, z.string().min(1, "must not be empty").optional()),
    AI_DAILY_BUDGET_USD: z.preprocess(blankToUndefined, z.coerce.number().positive("must be a positive number").optional()),
    AI_MONTHLY_BUDGET_USD: z.preprocess(blankToUndefined, z.coerce.number().positive("must be a positive number").optional()),
    // Selects the discovery provider for GENERAL-mode lead searches only
    // (TRIVIA_GAP/TRIVIA_CONFIRMED/COMPETITOR modes always use AI_PROVIDER's
    // discovery — see src/lib/research/providers/factory.ts). "mock" is the
    // safe default; "google" requires GOOGLE_PLACES_API_KEY. Deliberately a
    // separate setting from AI_PROVIDER — a business-directory lookup is not
    // an AI call and has its own, unrelated credential/billing account.
    PLACES_PROVIDER: z.preprocess(blankToUndefined, z.enum(["mock", "google"]).default("mock")),
    GOOGLE_PLACES_API_KEY: z.preprocess(blankToUndefined, z.string().min(1, "must not be empty").optional()),
    IMPORT_BATCH_TTL_HOURS: z.preprocess(
      blankToUndefined,
      z.coerce.number().positive("must be a positive number").max(24, "must be 24 or less").default(4),
    ),
    SENTRY_DSN: z.preprocess(blankToUndefined, z.string().url("must be a valid URL").optional()),
    // Encrypts ProviderConnection OAuth tokens at rest (AES-256-GCM, see
    // src/lib/comms/token-crypto.ts) — a 32-byte key, base64-encoded.
    // Required in production the same way NEXT_SERVER_ACTIONS_ENCRYPTION_KEY
    // is: optional in dev/test so the app boots without it, but a stable
    // value is mandatory once real tokens might actually be stored.
    TOKEN_ENCRYPTION_KEY: z.preprocess(blankToUndefined, z.string().min(1, "must not be empty").optional()),
    // Signs the {{unsubscribeLink}} token (src/lib/comms/unsubscribe-token.ts)
    // — an HMAC secret, not an encryption key (the link's payload,
    // contactId + expiry, isn't secret; it just needs tamper-evidence so an
    // unauthenticated visitor can't forge or extend one). Same
    // optional-in-dev/required-in-production shape as TOKEN_ENCRYPTION_KEY.
    UNSUBSCRIBE_TOKEN_SECRET: z.preprocess(blankToUndefined, z.string().min(1, "must not be empty").optional()),
    MICROSOFT_CLIENT_ID: z.preprocess(blankToUndefined, z.string().min(1, "must not be empty").optional()),
    MICROSOFT_CLIENT_SECRET: z.preprocess(blankToUndefined, z.string().min(1, "must not be empty").optional()),
    GOOGLE_CLIENT_ID: z.preprocess(blankToUndefined, z.string().min(1, "must not be empty").optional()),
    GOOGLE_CLIENT_SECRET: z.preprocess(blankToUndefined, z.string().min(1, "must not be empty").optional()),
    SEED_ADMIN_EMAIL: z.preprocess(blankToUndefined, z.string().email("must be a valid email").optional()),
    SEED_ADMIN_PASSWORD: z.preprocess(blankToUndefined, z.string().min(1, "must not be empty").optional()),
    // Module Nine: the transactional/system-email provider (password reset,
    // admin test-send) — deliberately separate from Module Six's
    // MICROSOFT_CLIENT_ID/GOOGLE_CLIENT_ID (per-user OAuth mailbox sending
    // for CRM outreach, unrelated and untouched by this setting). "mock" is
    // the safe default; "resend" requires RESEND_API_KEY. Even when
    // configured, actual sending stays off until an administrator flips
    // IntegrationSettings.emailSendingEnabled — this env var only selects
    // which provider *would* be used, matching PLACES_PROVIDER's own
    // credential-selection-only role.
    EMAIL_PROVIDER: z.preprocess(blankToUndefined, z.enum(["mock", "resend"]).default("mock")),
    RESEND_API_KEY: z.preprocess(blankToUndefined, z.string().min(1, "must not be empty").optional()),
    // The verified Resend sender address system email is sent from (e.g.
    // "Triviality CRM <noreply@yourdomain.com>") — must be on a domain
    // verified in the Resend dashboard. Required only once EMAIL_PROVIDER=
    // resend; the mock provider never reads it.
    RESEND_FROM_ADDRESS: z.preprocess(blankToUndefined, z.string().min(1, "must not be empty").optional()),
    // Verifies the Resend delivery-events webhook's signature (Svix-based
    // HMAC) — required only once RESEND_API_KEY is configured, since a
    // webhook has nothing to verify against without a real Resend account
    // sending it events in the first place.
    RESEND_WEBHOOK_SECRET: z.preprocess(blankToUndefined, z.string().min(1, "must not be empty").optional()),
  })
  .superRefine((value, ctx) => {
    if (value.AI_PROVIDER === "anthropic" && !value.AI_API_KEY) {
      ctx.addIssue({ code: "custom", path: ["AI_API_KEY"], message: "is required when AI_PROVIDER=anthropic" });
    }
    if (value.PLACES_PROVIDER === "google" && !value.GOOGLE_PLACES_API_KEY) {
      ctx.addIssue({ code: "custom", path: ["GOOGLE_PLACES_API_KEY"], message: "is required when PLACES_PROVIDER=google" });
    }
    if (value.EMAIL_PROVIDER === "resend" && !value.RESEND_API_KEY) {
      ctx.addIssue({ code: "custom", path: ["RESEND_API_KEY"], message: "is required when EMAIL_PROVIDER=resend" });
    }
    if (value.EMAIL_PROVIDER === "resend" && !value.RESEND_WEBHOOK_SECRET) {
      ctx.addIssue({ code: "custom", path: ["RESEND_WEBHOOK_SECRET"], message: "is required when EMAIL_PROVIDER=resend (verifies delivery-event webhook signatures)" });
    }
    if (value.EMAIL_PROVIDER === "resend" && !value.RESEND_FROM_ADDRESS) {
      ctx.addIssue({ code: "custom", path: ["RESEND_FROM_ADDRESS"], message: "is required when EMAIL_PROVIDER=resend" });
    }
    if (Boolean(value.SEED_ADMIN_EMAIL) !== Boolean(value.SEED_ADMIN_PASSWORD)) {
      ctx.addIssue({
        code: "custom",
        path: ["SEED_ADMIN_EMAIL"],
        message: "SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD must both be set or both be unset",
      });
    }
    if (value.NODE_ENV === "production" && !value.APP_URL) {
      ctx.addIssue({ code: "custom", path: ["APP_URL"], message: "is required when NODE_ENV=production" });
    }
    if (value.NODE_ENV === "production" && !value.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY) {
      ctx.addIssue({
        code: "custom",
        path: ["NEXT_SERVER_ACTIONS_ENCRYPTION_KEY"],
        message: "is required when NODE_ENV=production (a stable value across web instances/restarts)",
      });
    }
    if (value.NODE_ENV === "production" && !value.TOKEN_ENCRYPTION_KEY) {
      ctx.addIssue({
        code: "custom",
        path: ["TOKEN_ENCRYPTION_KEY"],
        message: "is required when NODE_ENV=production (encrypts stored OAuth tokens)",
      });
    }
    if (value.NODE_ENV === "production" && !value.UNSUBSCRIBE_TOKEN_SECRET) {
      ctx.addIssue({
        code: "custom",
        path: ["UNSUBSCRIBE_TOKEN_SECRET"],
        message: "is required when NODE_ENV=production (signs unsubscribe links)",
      });
    }
    if (Boolean(value.MICROSOFT_CLIENT_ID) !== Boolean(value.MICROSOFT_CLIENT_SECRET)) {
      ctx.addIssue({
        code: "custom",
        path: ["MICROSOFT_CLIENT_ID"],
        message: "MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET must both be set or both be unset",
      });
    }
    if (Boolean(value.GOOGLE_CLIENT_ID) !== Boolean(value.GOOGLE_CLIENT_SECRET)) {
      ctx.addIssue({
        code: "custom",
        path: ["GOOGLE_CLIENT_ID"],
        message: "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must both be set or both be unset",
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

/**
 * Parses and validates process.env once per process, memoized. Error
 * messages name the offending field and describe what's wrong, but never
 * include the received value — several of these fields (DATABASE_URL,
 * AI_API_KEY, SEED_ADMIN_PASSWORD) carry secrets, and a boot-failure log line
 * is exactly the kind of place a secret accidentally ends up in aggregated
 * logs if this isn't deliberate.
 */
export function getEnv(): Env {
  if (cached) return cached;

  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const lines = result.error.issues.map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join("\n")}`);
  }

  cached = result.data;
  return cached;
}

/** Test-only: clears the memoized env so a test can re-validate under different process.env values. */
export function resetEnvCacheForTests(): void {
  cached = null;
}
