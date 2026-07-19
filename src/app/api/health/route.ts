import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Unauthenticated by design — this is what Railway's health check hits, and
// it must never require a session. Returns only a fixed, generic shape:
// never a stack trace, an env var, a version string, or any other
// configuration detail that could help an attacker fingerprint the
// deployment. A failing DB connectivity check still returns 200 with
// database:"down" rather than 500 — Railway's own health-check semantics
// treat a non-2xx as "restart this instance," which is the wrong response
// to a transient DB blip the app itself can recover from once the pool
// reconnects; degraded-but-alive is a more useful signal here than a crash
// loop.
export async function GET() {
  let database: "up" | "down" = "up";
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    database = "down";
  }

  return NextResponse.json({ status: "ok", database });
}
