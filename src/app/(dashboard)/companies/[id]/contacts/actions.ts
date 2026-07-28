"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { companyScope } from "@/lib/companies/scope";
import { ContactSchema } from "@/lib/validation/contact";
import { formString } from "@/lib/form-data";
import { computeContactNormalizedFields } from "@/lib/data-quality/normalize";

export type ContactActionResult = { error?: string } | undefined;

async function requireCompanyAccess(companyId: string) {
  const user = await requireUser();
  requirePermission(user, "edit_leads");

  const scope = companyScope(user);
  if (!scope) {
    throw new Error("Forbidden: no access to this company");
  }

  const company = await prisma.company.findFirst({ where: { id: companyId, ...scope } });
  if (!company) {
    throw new Error("Forbidden: no access to this company");
  }

  return user;
}

function parseContactForm(formData: FormData) {
  return ContactSchema.safeParse({
    firstName: formString(formData, "firstName"),
    lastName: formString(formData, "lastName"),
    title: formString(formData, "title"),
    phone: formString(formData, "phone"),
    email: formString(formData, "email"),
  });
}

export async function createContact(
  companyId: string,
  _prevState: ContactActionResult,
  formData: FormData,
): Promise<ContactActionResult> {
  await requireCompanyAccess(companyId);

  const parsed = parseContactForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please correct the highlighted fields." };
  }

  await prisma.contact.create({
    data: {
      companyId,
      firstName: parsed.data.firstName,
      lastName: parsed.data.lastName,
      title: parsed.data.title ?? null,
      phone: parsed.data.phone ?? null,
      email: parsed.data.email ?? null,
      ...computeContactNormalizedFields(parsed.data),
    },
  });

  revalidatePath(`/companies/${companyId}`);
}

export async function updateContact(companyId: string, contactId: string, formData: FormData): Promise<ContactActionResult> {
  await requireCompanyAccess(companyId);

  const parsed = parseContactForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please correct the highlighted fields." };
  }

  const existing = await prisma.contact.findFirst({ where: { id: contactId, companyId, status: "ACTIVE" } });
  if (!existing) {
    return { error: "Contact not found." };
  }

  await prisma.contact.update({
    where: { id: contactId },
    data: {
      firstName: parsed.data.firstName,
      lastName: parsed.data.lastName,
      title: parsed.data.title ?? null,
      phone: parsed.data.phone ?? null,
      email: parsed.data.email ?? null,
      ...computeContactNormalizedFields(parsed.data),
    },
  });

  revalidatePath(`/companies/${companyId}`);
}

/**
 * Sets or clears the company's default-recipient contact for the email
 * composer (src/lib/comms/recipient.ts's resolveCompanyPageDefault).
 * `contactId: null` clears it. Validates the contact actually belongs to
 * this company -- the FK alone doesn't enforce that cross-row invariant.
 */
export async function setPrimaryContact(companyId: string, contactId: string | null): Promise<ContactActionResult> {
  await requireCompanyAccess(companyId);

  if (contactId !== null) {
    const contact = await prisma.contact.findFirst({ where: { id: contactId, companyId, status: "ACTIVE" } });
    if (!contact) {
      return { error: "Contact not found." };
    }
  }

  await prisma.company.update({ where: { id: companyId }, data: { primaryContactId: contactId } });
  revalidatePath(`/companies/${companyId}`);
}

export async function deleteContact(companyId: string, contactId: string): Promise<ContactActionResult> {
  await requireCompanyAccess(companyId);

  const existing = await prisma.contact.findFirst({ where: { id: contactId, companyId, status: "ACTIVE" } });
  if (!existing) {
    return { error: "Contact not found." };
  }

  await prisma.contact.delete({ where: { id: contactId } });
  revalidatePath(`/companies/${companyId}`);
}
