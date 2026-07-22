// Contact-merge consent/suppression conflict resolution — confirmed with
// the user: always the most restrictive value, no override, consistent
// with Module Six's CASL-safe default-deny design (src/lib/comms/
// consent.ts). Both contacts' full ConsentRecord history is preserved
// regardless (reassigned onto the survivor by mergeContacts()) — this only
// decides the *denormalized current-state* fields.
export type ConsentState = {
  emailPermitted: boolean;
  doNotContact: boolean;
  unsubscribedAt: Date | null;
  unsubscribeSource: string | null;
};

export function resolveConsentConflict(a: ConsentState, b: ConsentState): ConsentState {
  const doNotContact = a.doNotContact || b.doNotContact;
  const emailPermitted = a.emailPermitted && b.emailPermitted && !doNotContact;

  // Earliest non-null unsubscribe wins — being unsubscribed is the
  // restrictive state, and the earliest one is the longest-standing record
  // of that fact.
  const candidates = [a, b].filter((c) => c.unsubscribedAt !== null);
  const earliest = candidates.sort((x, y) => x.unsubscribedAt!.getTime() - y.unsubscribedAt!.getTime())[0] ?? null;

  return {
    emailPermitted,
    doNotContact,
    unsubscribedAt: earliest?.unsubscribedAt ?? null,
    unsubscribeSource: earliest?.unsubscribeSource ?? null,
  };
}
