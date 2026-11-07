// Who the label is addressed to ("Attn: ..."), and the order labels print in.
import { tidy } from "./address";

export const MANAGER = "MANAGER" as const;
export const MANAGER_NAME = "Manager";

export type ContactOption = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  doNotContact: boolean;
  status: string;
};

/** "Jane Smith", "Jane", "Smith", or null when there's no usable name. */
export function contactDisplayName(contact: Pick<ContactOption, "firstName" | "lastName">): string | null {
  const parts = [tidy(contact.firstName), tidy(contact.lastName)].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(" ") : null;
}

/** A contact that may be named on a label: active and not do-not-contact. */
export function contactUsable(contact: ContactOption): boolean {
  return contact.status === "ACTIVE" && !contact.doNotContact;
}

export type Attention = {
  /** What prints after "Attn: ". */
  name: string;
  contactId: string | null;
  /** Shown on review: why it's Manager, or that an override is in use. */
  note: string | null;
  overridden: boolean;
};

/**
 * The primary contact by default; "Manager" when there's no primary contact
 * or it has no usable name (or can't be contacted). Never silently picks a
 * different contact. An override (a contact of this company, or Manager)
 * applies to this job only; an override naming a contact that isn't one of
 * this company's usable contacts is rejected by the caller before it gets
 * here, and ignored here as a second line of defence.
 */
export function chooseAttention(primaryContactId: string | null, contacts: ContactOption[], override: string | undefined): Attention {
  if (override === MANAGER) return { name: MANAGER_NAME, contactId: null, note: "Manager chosen for this job", overridden: true };
  if (override) {
    const chosen = contacts.find((contact) => contact.id === override && contactUsable(contact));
    const name = chosen ? contactDisplayName(chosen) : null;
    if (chosen && name) return { name, contactId: chosen.id, note: "Contact chosen for this job", overridden: true };
  }

  if (!primaryContactId) return { name: MANAGER_NAME, contactId: null, note: "No primary contact", overridden: false };
  const primary = contacts.find((contact) => contact.id === primaryContactId);
  if (!primary) return { name: MANAGER_NAME, contactId: null, note: "No primary contact", overridden: false };
  if (primary.doNotContact) return { name: MANAGER_NAME, contactId: null, note: "Primary contact is marked do not contact", overridden: false };
  if (primary.status !== "ACTIVE") return { name: MANAGER_NAME, contactId: null, note: "Primary contact is no longer active", overridden: false };
  const name = contactDisplayName(primary);
  if (!name) return { name: MANAGER_NAME, contactId: null, note: "Primary contact has no name", overridden: false };
  return { name, contactId: primary.id, note: null, overridden: false };
}

/**
 * Alphabetical by company name as displayed: case-insensitive, surrounding
 * whitespace ignored, "The" kept, punctuation untouched; ties broken by id
 * so the order never changes between review, pages, generation and
 * reprints. A plain code-unit comparison (not locale) so every server
 * sorts identically.
 */
export function compareCompanies(a: { name: string; id: string }, b: { name: string; id: string }): number {
  const an = a.name.trim().toLowerCase();
  const bn = b.name.trim().toLowerCase();
  if (an !== bn) return an < bn ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
