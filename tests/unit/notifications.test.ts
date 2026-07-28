import { describe, it, expect } from "vitest";
import { describeNotification } from "../../src/lib/notifications";

describe("describeNotification", () => {
  it("includes the company name and subject for a DELIVERY_FAILURE", () => {
    expect(describeNotification("DELIVERY_FAILURE", { companyName: "Acme Trivia", subject: "Hi" })).toBe(
      'Email failed to send to Acme Trivia: "Hi".',
    );
  });

  it("degrades gracefully when payload fields are missing", () => {
    expect(describeNotification("DELIVERY_FAILURE", {})).toBe("Email failed to send.");
  });

  it("includes the stop reason for SEQUENCE_PAUSED", () => {
    expect(describeNotification("SEQUENCE_PAUSED", { reason: "The linked contact has opted out of email." })).toBe(
      "A follow-up sequence stopped (The linked contact has opted out of email.).",
    );
  });

  it("returns a generic message for an unrecognized type", () => {
    expect(describeNotification("SOMETHING_NEW", {})).toBe("You have a new notification.");
  });

  it("includes the company and suggested stage for SCHEDULED_EMAIL_STAGE_SUGGESTED", () => {
    expect(describeNotification("SCHEDULED_EMAIL_STAGE_SUGGESTED", { companyName: "Acme Trivia", suggestedStageName: "Interested" })).toBe(
      'Your scheduled email to Acme Trivia just sent — its template suggests moving to "Interested".',
    );
  });

  it("degrades gracefully when SCHEDULED_EMAIL_STAGE_SUGGESTED payload fields are missing", () => {
    expect(describeNotification("SCHEDULED_EMAIL_STAGE_SUGGESTED", {})).toBe(
      'Your scheduled email to a company just sent — its template suggests moving to "a new stage".',
    );
  });
});
