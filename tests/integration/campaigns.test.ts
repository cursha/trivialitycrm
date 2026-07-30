import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import { createRoleWithPermissions, createTestUser, createTeam, createLeadTypeFixture, createPipelineStageFixture, createCompanyFixture, loginAs } from "../helpers/fixtures";
import { resetFakeCookies } from "../setup/mock-next";
import { createSalesList, addCompaniesToList } from "../../src/app/(dashboard)/sales-lists/actions";
import { createCampaign, generateCampaignPreview } from "../../src/app/(dashboard)/campaigns/actions";

beforeEach(async () => {
  await resetDatabase();
  resetFakeCookies();
});

const ONE_STEP = [{ waitDays: 0 }];

async function baseFixtures() {
  const role = await createRoleWithPermissions("CampaignUser", ["view_sales_lists", "create_sales_lists", "manage_own_sales_lists", "create_campaigns", "view_all_leads"]);
  const user = await createTestUser({ roleId: role.id });
  const leadType = await createLeadTypeFixture();
  const stage = await createPipelineStageFixture("New", { isDefault: true });
  return { user, leadType, stage };
}

async function companyWithEligibleContact(user: Awaited<ReturnType<typeof createTestUser>>, leadType: { id: string }, stage: { id: string }, name: string) {
  const company = await createCompanyFixture({ name, leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: null, createdById: user.id });
  const contact = await testPrisma.contact.create({ data: { companyId: company.id, firstName: "Jamie", lastName: "Lee", email: `${company.id}@example.test`, doNotContact: false } });
  await testPrisma.company.update({ where: { id: company.id }, data: { primaryContactId: contact.id } });
  return company;
}

describe("createCampaign", () => {
  it("creates a recipient row for every list company, splitting eligible/skipped", async () => {
    const { user, leadType, stage } = await baseFixtures();
    await loginAs(user.id);
    const eligible = await companyWithEligibleContact(user, leadType, stage, "Eligible Co");
    const ineligible = await createCompanyFixture({ name: "No Contact Co", leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: null, createdById: user.id });

    const list = await createSalesList({ name: "Campaign List", purpose: "EMAIL_CAMPAIGN", type: "FIXED", visibility: "PRIVATE" });
    if (!("success" in list)) throw new Error("failed");
    await addCompaniesToList(list.id, [eligible.id, ineligible.id]);

    const result = await createCampaign({ name: "My Campaign", listId: list.id, campaignInstructions: "Mention our new offering.", steps: ONE_STEP });
    expect(result).toHaveProperty("success", true);
    if (!("success" in result)) throw new Error("unreachable");

    const recipients = await testPrisma.campaignRecipient.findMany({ where: { campaignId: result.id } });
    expect(recipients).toHaveLength(2);
    const eligibleRow = recipients.find((r) => r.companyId === eligible.id)!;
    const ineligibleRow = recipients.find((r) => r.companyId === ineligible.id)!;
    expect(eligibleRow.status).toBe("PENDING");
    expect(eligibleRow.contactId).not.toBeNull();
    expect(ineligibleRow.status).toBe("SKIPPED");
    expect(ineligibleRow.skipReason).toContain("No eligible primary contact");
  });

  it("never creates two recipients for the same company (schema-enforced)", async () => {
    const { user, leadType, stage } = await baseFixtures();
    await loginAs(user.id);
    const company = await companyWithEligibleContact(user, leadType, stage, "Once Co");
    const list = await createSalesList({ name: "Once List", purpose: "EMAIL_CAMPAIGN", type: "FIXED", visibility: "PRIVATE" });
    if (!("success" in list)) throw new Error("failed");
    await addCompaniesToList(list.id, [company.id]);

    const result = await createCampaign({ name: "Once", listId: list.id, campaignInstructions: "Hello.", steps: ONE_STEP });
    if (!("success" in result)) throw new Error("unreachable");
    const recipients = await testPrisma.campaignRecipient.findMany({ where: { campaignId: result.id, companyId: company.id } });
    expect(recipients).toHaveLength(1);
  });

  it("rejects a campaign built from a non-EMAIL_CAMPAIGN list", async () => {
    const { user } = await baseFixtures();
    await loginAs(user.id);
    const list = await createSalesList({ name: "Wrong Purpose", purpose: "GENERAL_SALES", type: "DYNAMIC", visibility: "PRIVATE", filters: {} });
    if (!("success" in list)) throw new Error("failed");

    const result = await createCampaign({ name: "Bad", listId: list.id, campaignInstructions: "Hi.", steps: ONE_STEP });
    expect(result).toHaveProperty("error");
  });

  it("requires at least one guidance source (instructions, reusable template, or approved template)", async () => {
    const { user, leadType, stage } = await baseFixtures();
    await loginAs(user.id);
    const company = await companyWithEligibleContact(user, leadType, stage, "Co");
    const list = await createSalesList({ name: "List", purpose: "EMAIL_CAMPAIGN", type: "FIXED", visibility: "PRIVATE" });
    if (!("success" in list)) throw new Error("failed");
    await addCompaniesToList(list.id, [company.id]);

    const result = await createCampaign({ name: "No Guidance", listId: list.id, campaignInstructions: "", steps: ONE_STEP });
    expect(result).toHaveProperty("error");
  });

  it("rejects campaign creation from a user without create_campaigns", async () => {
    const role = await createRoleWithPermissions("NoCampaignAccess", ["view_sales_lists"]);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);

    await expect(createCampaign({ name: "Should Fail", listId: "nonexistent", campaignInstructions: "Hi", steps: ONE_STEP })).rejects.toThrow();
  });
});

describe("generateCampaignPreview", () => {
  it("generates a personalized, frozen-format snapshot for every eligible recipient", async () => {
    const { user, leadType, stage } = await baseFixtures();
    await loginAs(user.id);
    const company = await companyWithEligibleContact(user, leadType, stage, "Preview Co");
    const list = await createSalesList({ name: "Preview List", purpose: "EMAIL_CAMPAIGN", type: "FIXED", visibility: "PRIVATE" });
    if (!("success" in list)) throw new Error("failed");
    await addCompaniesToList(list.id, [company.id]);
    const created = await createCampaign({ name: "Preview Campaign", listId: list.id, campaignInstructions: "Mention our trivia nights.", steps: ONE_STEP });
    if (!("success" in created)) throw new Error("unreachable");

    const result = await generateCampaignPreview(created.id);
    expect(result).toHaveProperty("success", true);

    const recipient = await testPrisma.campaignRecipient.findFirstOrThrow({ where: { campaignId: created.id, companyId: company.id } });
    const snapshot = await testPrisma.campaignMessageSnapshot.findFirst({ where: { recipientId: recipient.id } });
    expect(snapshot).not.toBeNull();
    expect(snapshot!.body).toContain("{{unsubscribeLink}}");
    expect(snapshot!.subject).toContain("Preview Co");
  });

  it("skips a recipient that became ineligible between creation and preview (do-not-contact)", async () => {
    const { user, leadType, stage } = await baseFixtures();
    await loginAs(user.id);
    const company = await companyWithEligibleContact(user, leadType, stage, "Turns Bad Co");
    const list = await createSalesList({ name: "Turns Bad List", purpose: "EMAIL_CAMPAIGN", type: "FIXED", visibility: "PRIVATE" });
    if (!("success" in list)) throw new Error("failed");
    await addCompaniesToList(list.id, [company.id]);
    const created = await createCampaign({ name: "Turns Bad", listId: list.id, campaignInstructions: "Hello.", steps: ONE_STEP });
    if (!("success" in created)) throw new Error("unreachable");

    await testPrisma.company.update({ where: { id: company.id }, data: { doNotContact: true } });

    await generateCampaignPreview(created.id);

    const recipient = await testPrisma.campaignRecipient.findFirstOrThrow({ where: { campaignId: created.id, companyId: company.id } });
    expect(recipient.status).toBe("SKIPPED");
    expect(await testPrisma.campaignMessageSnapshot.findFirst({ where: { recipientId: recipient.id } })).toBeNull();
  });

  it("only the creator or an administrator can generate a preview", async () => {
    const { user, leadType, stage } = await baseFixtures();
    const team = await createTeam();
    await testPrisma.user.update({ where: { id: user.id }, data: { teamId: team.id } });
    await loginAs(user.id);
    const company = await companyWithEligibleContact(user, leadType, stage, "Co");
    const list = await createSalesList({ name: "List", purpose: "EMAIL_CAMPAIGN", type: "FIXED", visibility: "SHARED_TEAM" });
    if (!("success" in list)) throw new Error("failed");
    await addCompaniesToList(list.id, [company.id]);
    const created = await createCampaign({ name: "Owner Only", listId: list.id, campaignInstructions: "Hi.", steps: ONE_STEP });
    if (!("success" in created)) throw new Error("unreachable");

    const otherRole = await createRoleWithPermissions("OtherCampaignUser", ["view_sales_lists", "create_campaigns"]);
    const other = await createTestUser({ roleId: otherRole.id, teamId: team.id });
    await loginAs(other.id);

    const result = await generateCampaignPreview(created.id);
    expect(result).toHaveProperty("error");
  });
});
