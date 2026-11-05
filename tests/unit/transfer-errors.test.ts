import { describe, it, expect } from "vitest";
import { TransferPayloadSchema, type TransferPayload } from "../../src/lib/validation/transfer";
import { describeInvalidRows } from "../../src/lib/validation/transfer-errors";

function row(resultId: string, name: string, postalCode: string) {
  return { resultId, name, address1: "", city: "Milton", region: "ON", postalCode, country: "Canada", phone: "", email: "", websiteUrl: "" };
}

function check(rows: ReturnType<typeof row>[]) {
  const payload = { assignedToId: "u1", pipelineStageId: "s1", rows } as unknown as TransferPayload;
  const parsed = TransferPayloadSchema.safeParse(payload);
  expect(parsed.success).toBe(false);
  return describeInvalidRows(parsed.error!.issues, payload);
}

describe("describeInvalidRows", () => {
  it("names the one company with a bad postal code and marks its field", () => {
    const result = check([row("r1", "Good Pub", "L9T 2X5"), row("r2", "Bad Pub", "12345")]);
    expect(result.error).toBe("Bad Pub: Enter a valid Canadian postal code (e.g. L9T 2X5).");
    expect(result.fieldErrors).toEqual({ r2: { postalCode: "Enter a valid Canadian postal code (e.g. L9T 2X5)." } });
  });

  it("lists every company when several are wrong", () => {
    const result = check([row("r1", "First Pub", "nope"), row("r2", "Fine Pub", ""), row("r3", "Third Pub", "V5K 0A1")]);
    expect(result.error).toBe("Fix the fields marked in red for 2 leads: First Pub, Third Pub.");
    expect(Object.keys(result.fieldErrors)).toEqual(["r1", "r3"]);
    expect(result.fieldErrors.r3.postalCode).toMatch(/BC, not ON/);
  });
});
