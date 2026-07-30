import type { SalesListPurpose } from "@/generated/prisma/enums";

export type EligibilityContact = {
  status: "ACTIVE" | "MERGED";
  email: string | null;
  phone: string | null;
  doNotContact: boolean;
  unsubscribedAt: Date | null;
};

export type EligibilityCompany = {
  status: "ACTIVE" | "ARCHIVED" | "MERGED";
  doNotContact: boolean;
  isExistingCustomer: boolean;
  phone: string | null;
  primaryContact: EligibilityContact | null;
  /** Whether the primary contact's email address has a permanent bounce on
   * file — computed by the caller (a query over EmailMessage), passed in
   * here so this function stays pure/unit-testable rather than reaching
   * into the database itself. */
  primaryContactHasPermanentBounce?: boolean;
};

export type EligibilityResult = { eligible: boolean; reasons: string[] };

/**
 * The single source of truth for "can this company currently be used" —
 * shared by the List Builder preview, the List page's ineligible-company
 * display, and the automatic skip performed when starting a calling
 * session or sending a campaign (per the spec: "The system must
 * automatically skip ineligible records... Users must not be able to
 * override suppression, unsubscribe, permanent-bounce, or do-not-contact
 * restrictions."). Purpose-dependent: a General Sales List only cares about
 * the universal blockers (archived/merged/do-not-contact); Calling also
 * needs a phone number; Email Campaign needs a genuinely usable, permitted
 * primary contact.
 */
export function evaluateCompanyEligibility(company: EligibilityCompany, purpose: SalesListPurpose): EligibilityResult {
  const reasons: string[] = [];

  if (company.status === "ARCHIVED") reasons.push("Archived");
  if (company.status === "MERGED") reasons.push("Merged into another company");
  if (company.doNotContact) reasons.push("Do not contact");

  if (purpose === "CALLING") {
    if (!company.phone) reasons.push("Missing telephone number");
  }

  if (purpose === "EMAIL_CAMPAIGN") {
    if (company.isExistingCustomer) reasons.push("Existing customer excluded by campaign rules");
    const contact = company.primaryContact;
    if (!contact || contact.status !== "ACTIVE") {
      reasons.push("No eligible primary contact");
    } else {
      if (!contact.email) reasons.push("Missing email address");
      if (contact.doNotContact) reasons.push("Contact has opted out / do not contact");
      if (contact.unsubscribedAt) reasons.push("Unsubscribed");
      if (company.primaryContactHasPermanentBounce) reasons.push("Permanent email bounce on file");
    }
  }

  return { eligible: reasons.length === 0, reasons };
}
