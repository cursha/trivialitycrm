// Pure default-recipient resolution for the email composer (spec section
// 4.2's "default recipient" rules). Deliberately doesn't handle manual/
// free-text entry -- every send in this app is tied to a tracked Contact
// (see email-panel.tsx's own doc comment: "every send must be tied to a
// tracked contact, not a free-text address"), a consent-tracking guardrail
// (Contact.emailPermitted/doNotContact only exist on tracked rows) this
// module doesn't relax. See the email-system delta plan for that open
// question.
export type RecipientContact = { id: string; email: string | null };

/** Contact-row entry point: that contact is the default if it currently
 * has an email; otherwise there is no default and the composer's own
 * contact dropdown is left for the user to pick from. */
export function resolveContactRowDefault(contact: RecipientContact): string | null {
  return contact.email ? contact.id : null;
}

/** Company-page entry point: the designated primary contact, if one is
 * set and it currently has an email -- a primary contact can lose its
 * email, or be merged/archived, after being marked primary, so the
 * pointer is never trusted blindly. No default otherwise; the user picks
 * from the company's other contacts in the composer. */
export function resolveCompanyPageDefault(primaryContact: RecipientContact | null): string | null {
  return primaryContact?.email ? primaryContact.id : null;
}
