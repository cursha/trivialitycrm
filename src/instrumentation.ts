// Runs once when a new server instance starts. The search job runner
// (src/lib/research/run-search.ts) is single-process/in-memory — if the
// process is restarted while a LeadSearch is RUNNING, nothing will ever
// finish it. Sweep those on boot so they surface as FAILED instead of
// silently hanging forever in the status UI.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { prisma } = await import("@/lib/prisma");

  const staleCutoff = new Date(Date.now() - 5 * 60 * 1000);
  await prisma.leadSearch.updateMany({
    where: { status: "RUNNING", OR: [{ heartbeatAt: { lt: staleCutoff } }, { heartbeatAt: null }] },
    data: { status: "FAILED", errorMessage: "Interrupted by a server restart before the search finished.", completedAt: new Date() },
  });
}
