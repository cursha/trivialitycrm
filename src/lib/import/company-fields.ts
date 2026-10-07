import { IMPORT_FIELD_LABELS, type ImportTargetField, type ImportTriviaStatus, type ImportWeekday, type MappedRow } from "@/lib/validation/import";

/**
 * Pure helpers turning a validated import row (see mapAndValidateRow) into
 * Company/Contact data — shared by the import preview, which lists what a
 * row will change, and the commit, which makes the change, so the two can't
 * disagree. No I/O.
 */

/** Provider names that describe how a pub runs trivia rather than who runs
 * it — stored as text, never linked to a Competitor. */
const NON_COMPETITOR_PROVIDERS = new Set(["inhouse", "independent", "none", "no", "na"]);

export function isLinkableProvider(name: string): boolean {
  const key = name.toLowerCase().replace(/[^a-z]/g, "");
  return key.length > 0 && !NON_COMPETITOR_PROVIDERS.has(key);
}

export type ImportedContact = { firstName: string; lastName: string; title: string | null; phone: string | null; email: string | null };

/** The contact to create, or null when the row has no full name (its
 * details then go into the company notes instead — see importNoteLines). */
export function importedContact(values: MappedRow): ImportedContact | null {
  if (!values.contactFirstName || !values.contactLastName) return null;
  return {
    firstName: values.contactFirstName,
    lastName: values.contactLastName,
    title: values.contactTitle || null,
    phone: values.contactPhone || null,
    email: values.contactEmail || null,
  };
}

/** The lines this row adds to Company.notes, in order: research priority
 * first, then the notes column, then contact details that have no Contact
 * column (a contact note, or a contact without a full name). */
export function importNoteLines(values: MappedRow): string[] {
  const lines: string[] = [];
  if (values.researchPriority) lines.push(`Research priority: ${values.researchPriority}`);
  if (values.notes) lines.push(values.notes);

  const contactName = [values.contactFirstName, values.contactLastName].filter(Boolean).join(" ");
  if (!importedContact(values)) {
    const details = [values.contactTitle, values.contactPhone, values.contactEmail].filter(Boolean).join(" · ");
    if (contactName || details) lines.push(`Contact: ${[contactName, details].filter(Boolean).join(" — ")}`);
  }
  if (values.contactNote) lines.push(contactName ? `Contact note (${contactName}): ${values.contactNote}` : `Contact note: ${values.contactNote}`);
  return lines;
}

/** Notes for a brand-new company, or null when the row adds none. */
export function newCompanyNotes(values: MappedRow): string | null {
  const lines = importNoteLines(values);
  return lines.length > 0 ? lines.join("\n") : null;
}

/** Existing notes with this row's lines appended under a dated header —
 * skipping any line the notes already contain, so re-importing the same
 * file adds nothing. Null when there's nothing new. */
export function appendImportNotes(existing: string | null, values: MappedRow, importedOn: string, filename: string): string | null {
  const current = existing ?? "";
  // Whole lines only: "Hi" mustn't count as already there because the
  // notes say "High".
  const padded = `\n${current.replace(/\r\n/g, "\n")}\n`;
  const lines = importNoteLines(values).filter((line) => !padded.includes(`\n${line.replace(/\r\n/g, "\n")}\n`));
  if (lines.length === 0) return null;
  const block = [`— Imported ${importedOn} (${filename}) —`, ...lines].join("\n");
  return current.trim() ? `${current.trimEnd()}\n\n${block}` : block;
}

const TEXT_RESEARCH_FIELDS = [
  "currentEntertainment",
  "triviaHistory",
  "verifiedEvidenceSummary",
  "inferredEvidenceSummary",
  "missingInformation",
  "recommendedSalesApproach",
  "recommendedNextAction",
] as const;

export type ImportResearchData = {
  currentEntertainment?: string;
  triviaHistory?: string;
  verifiedEvidenceSummary?: string;
  inferredEvidenceSummary?: string;
  missingInformation?: string;
  recommendedSalesApproach?: string;
  recommendedNextAction?: string;
  triviaStatus?: ImportTriviaStatus;
  competitorTriviaProvider?: string;
  competitorId?: string;
  competitorTriviaDay?: ImportWeekday;
  slowNight?: ImportWeekday;
  needsReview?: boolean;
  needsReviewReason?: string;
};

/** Research columns for a new company. `competitorId` is the tracked
 * Competitor the provider name matched, if any. */
export function newCompanyResearch(values: MappedRow, competitorId: string | null): ImportResearchData {
  const data: ImportResearchData = {};
  for (const field of TEXT_RESEARCH_FIELDS) if (values[field]) data[field] = values[field];
  data.triviaStatus = (values.triviaStatus || "UNCERTAIN") as ImportTriviaStatus;
  if (values.competitorTriviaProvider) data.competitorTriviaProvider = values.competitorTriviaProvider;
  if (competitorId) data.competitorId = competitorId;
  if (values.competitorTriviaDay) data.competitorTriviaDay = values.competitorTriviaDay as ImportWeekday;
  if (values.slowNight) data.slowNight = values.slowNight as ImportWeekday;
  if (values.needsReview === "true") {
    data.needsReview = true;
    if (values.missingInformation) data.needsReviewReason = values.missingInformation;
  }
  return data;
}

export type ExistingImportTarget = {
  address1: string | null;
  postalCode: string | null;
  phone: string | null;
  email: string | null;
  websiteUrl: string | null;
  currentEntertainment: string | null;
  triviaHistory: string | null;
  verifiedEvidenceSummary: string | null;
  inferredEvidenceSummary: string | null;
  missingInformation: string | null;
  recommendedSalesApproach: string | null;
  recommendedNextAction: string | null;
  triviaStatus: ImportTriviaStatus;
  competitorTriviaProvider: string | null;
  competitorId: string | null;
  competitorTriviaDay: ImportWeekday | null;
  slowNight: ImportWeekday | null;
  needsReview: boolean;
  needsReviewReason: string | null;
};

const FILLABLE_BASIC_FIELDS = ["address1", "postalCode", "phone", "email", "websiteUrl"] as const;

export type ExistingCompanyFill = {
  data: ImportResearchData & Partial<Record<(typeof FILLABLE_BASIC_FIELDS)[number], string>>;
  /** The import fields this fills in, for the preview. */
  filled: ImportTargetField[];
};

/**
 * What a row matching an existing company fills in: only fields that are
 * empty there now — never a value already on the company. "Empty" for
 * triviaStatus is UNCERTAIN (its default) and for needsReview is false.
 * Lead type, stage, salesperson, source and the name/location are never
 * touched.
 */
export function fillExistingCompany(existing: ExistingImportTarget, values: MappedRow, competitorId: string | null): ExistingCompanyFill {
  const data: ExistingCompanyFill["data"] = {};
  const filled: ImportTargetField[] = [];

  for (const field of [...FILLABLE_BASIC_FIELDS, ...TEXT_RESEARCH_FIELDS]) {
    if (values[field] && !existing[field]) {
      data[field] = values[field];
      filled.push(field);
    }
  }
  if (values.triviaStatus && values.triviaStatus !== "UNCERTAIN" && existing.triviaStatus === "UNCERTAIN") {
    data.triviaStatus = values.triviaStatus as ImportTriviaStatus;
    filled.push("triviaStatus");
  }
  if (values.competitorTriviaProvider && !existing.competitorTriviaProvider) {
    data.competitorTriviaProvider = values.competitorTriviaProvider;
    filled.push("competitorTriviaProvider");
  }
  // The link follows the provider it came from: only when the company has
  // no competitor yet and its provider (now or as just filled) is this one.
  const provider = existing.competitorTriviaProvider ?? data.competitorTriviaProvider;
  if (competitorId && !existing.competitorId && provider?.trim().toLowerCase() === values.competitorTriviaProvider.trim().toLowerCase()) {
    data.competitorId = competitorId;
    if (!filled.includes("competitorTriviaProvider")) filled.push("competitorTriviaProvider");
  }
  for (const field of ["competitorTriviaDay", "slowNight"] as const) {
    if (values[field] && !existing[field]) {
      data[field] = values[field] as ImportWeekday;
      filled.push(field);
    }
  }
  if (values.needsReview === "true" && !existing.needsReview) {
    data.needsReview = true;
    filled.push("needsReview");
  }
  if ((data.needsReview || existing.needsReview) && values.missingInformation && !existing.needsReviewReason) {
    data.needsReviewReason = values.missingInformation;
    if (!filled.includes("needsReview")) filled.push("needsReview");
  }
  return { data, filled };
}

export function fieldLabel(field: ImportTargetField): string {
  return IMPORT_FIELD_LABELS[field].replace(/ \*$/, "").replace(/ \(.*\)$/, "");
}
