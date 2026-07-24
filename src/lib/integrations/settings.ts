// Module Nine: the singleton IntegrationSettings row — currently just the
// email-sending kill switch (see prisma/schema.prisma's doc comment on the
// model). AI's equivalent toggle reuses the existing AiSettings.
// researchEnabled field (src/lib/ai/budget.ts) rather than duplicating it
// here.
//
// No `import "server-only"` — src/lib/transactional/send-system-email.ts
// (which runs in the worker under plain tsx) needs this too; same reasoning
// as every other settings module in this codebase (see src/lib/ai/budget.ts).
import { prisma } from "../prisma";

export type IntegrationSettingsValues = { emailSendingEnabled: boolean };

/** Find-or-create, mirroring getAiSettings()/WorkspaceSettings' own
 * find-or-fallback pattern rather than assuming the seed script always ran
 * first. */
export async function getIntegrationSettings(): Promise<IntegrationSettingsValues> {
  const existing = await prisma.integrationSettings.findUnique({ where: { id: 1 } });
  if (existing) return { emailSendingEnabled: existing.emailSendingEnabled };

  const created = await prisma.integrationSettings.create({ data: { id: 1 } });
  return { emailSendingEnabled: created.emailSendingEnabled };
}
