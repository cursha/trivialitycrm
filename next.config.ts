import type { NextConfig } from "next";
import { buildSecurityHeaders, hostnameFromUrl } from "./src/lib/security/headers";

// Verified against node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md
// ("Without Nonces" section) and .../05-config/01-next-config-js/{headers,output}.md
// for Next 16 — this repo's AGENTS.md warns not to assume header/config
// mechanics from pre-16 training knowledge. Static (no-nonce) CSP is
// sufficient here: every protected page already forces dynamic rendering
// (requireUser() reads cookies) and there's no third-party/user-supplied
// inline script use case. style-src 'unsafe-inline' (see headers.ts) is a
// placeholder pending a manual browser click-through against the real
// production build — see MODULE_3_REPORT.md.
const isProduction = process.env.NODE_ENV === "production";

// APP_URL is required at runtime once NODE_ENV=production (see
// src/lib/env.ts) but this file also loads in dev/test, where it's unset.
const appHostname = hostnameFromUrl(process.env.APP_URL);

const nextConfig: NextConfig = {
  // Deliberately NOT output: "standalone" — the Dockerfile runs on the full
  // node_modules instead of standalone's pruned trace, because the Prisma
  // CLI (invoked as a subprocess by Railway's Pre-Deploy Command, never
  // imported by app code) isn't reliably included in that trace. Verified
  // by an actual failed container run during this module's build testing,
  // not assumed — see the Dockerfile's `web` stage comment and
  // MODULE_3_REPORT.md.
  experimental: {
    serverActions: {
      allowedOrigins: appHostname ? [appHostname] : undefined,
    },
  },

  async headers() {
    return [{ source: "/(.*)", headers: buildSecurityHeaders(isProduction) }];
  },
};

export default nextConfig;
