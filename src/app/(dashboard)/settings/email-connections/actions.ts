"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { disconnectMailbox } from "@/lib/comms/connections";

const PATH = "/settings/email-connections";

export async function disconnectMailboxAction(): Promise<void> {
  const user = await requireUser();
  requirePermission(user, "connect_mailbox");
  // Deliberately no target-user parameter — connect_mailbox is inherently
  // self-scoped (ProviderConnection.userId is unique per user), so this
  // action can only ever disconnect the caller's own mailbox, never
  // someone else's by passing a different id.
  await disconnectMailbox(user.id);
  revalidatePath(PATH);
}
