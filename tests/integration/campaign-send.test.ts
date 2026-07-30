import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import { createRoleWithPermissions, createTestUser, createTeam, createLeadTypeFixture, createPipelineStageFixture, createCompanyFixture, loginAs } from "../helpers/fixtures";
import { resetFakeCookies } from "../setup/mock-next";
import { resetEnvCacheForTests } from "../../src/lib/env";
import { encryptToken } from "../../src/lib/comms/token-crypto";
import { SIMULATED_SEND_FAILURE_ADDRESS } from "../../src/lib/comms/providers/mock";
import { createSalesList, addCompaniesToList } from "../../src/app/(dashboard)/sales-lists/actions";
import { createCampaign, generateCampaignPreview, approveCampaign, sendCampaignNow, scheduleCampaign, cancelCampaign, retryFailedRecipients } from "../../src/app/(dashboard)/campaigns/actions";
import { processDueCampaignStep } from "../../src/lib/campaigns/run-step";
import { runSendCampaignTick } from "../../worker/handlers/send-campaign-tick";

const TEST_KEY = "SRvbw8Ualx2XC/Ekfrk0RWORk0fg8/dcL1kL5krkqbk=";
const mutableEnv = process.env as Record<string, string | undefined>;
const ONE_STEP = [{ waitDays: 0 }];

beforeEach(async () => {
  await resetDatabase();
  resetFakeCookies();
  mutableEnv.TOKEN_ENCRYPTION_KEY = TEST_KEY;
  mutableEnv.UNSUBSCRIBE_TOKEN_SECRET = TEST_KEY;
  resetEnvCacheForTests();
});

afterEach(() => {
  delete mutableEnv.TOKEN_ENCRYPTION_KEY;
  delete mutableEnv.UNSUBSCRIBE_TOKEN_SECRET;
  resetEnvCacheForTests();
});

/** Test-side stand-in for what campaign-step-tick + the worker would do:
 * process every currently-due ACTIVE recipient's current step (mirrors the
 * tick's own `nextStepDueAt <= now` filter — processDueCampaignStep itself
 * trusts the tick's filtering and doesn't re-check due time, same as
 * processDueSequenceStep). */
async function processAllDueSteps(campaignId: string): Promise<void> {
  const due = await testPrisma.campaignRecipient.findMany({
    where: { campaignId, status: "ACTIVE", nextStepDueAt: { lte: new Date() } },
    select: { id: true, currentStepId: true },
  });
  for (const recipient of due) {
    if (recipient.currentStepId) await processDueCampaignStep(recipient.id, recipient.currentStepId);
  }
}

async function connectMailbox(userId: string) {
  return testPrisma.providerConnection.create({
    data: {
      userId,
      provider: "MICROSOFT",
      providerAccountEmail: "salesperson@example.test",
      encryptedAccessToken: encryptToken("real-access-token"),
      encryptedRefreshToken: encryptToken("real-refresh-token"),
      scopes: ["Mail.Send"],
      tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      status: "CONNECTED",
    },
  });
}

async function baseFixtures() {
  const role = await createRoleWithPermissions("CampaignSender", ["view_sales_lists", "create_sales_lists", "manage_own_sales_lists", "create_campaigns", "send_campaigns", "view_all_leads"]);
  const user = await createTestUser({ roleId: role.id });
  const leadType = await createLeadTypeFixture();
  const stage = await createPipelineStageFixture("New", { isDefault: true });
  return { user, leadType, stage };
}

async function companyWithEligibleContact(
  user: Awaited<ReturnType<typeof createTestUser>>,
  leadType: { id: string },
  stage: { id: string },
  name: string,
  email = `${name.replace(/\s+/g, "-").toLowerCase()}@example.test`,
) {
  const company = await createCompanyFixture({ name, leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: user.id, createdById: user.id });
  const contact = await testPrisma.contact.create({ data: { companyId: company.id, firstName: "Jamie", lastName: "Lee", email, doNotContact: false } });
  await testPrisma.company.update({ where: { id: company.id }, data: { primaryContactId: contact.id } });
  return { company, contact };
}

async function readyCampaign(overrides: { recipientEmail?: string; secondRecipientEmail?: string; steps?: { waitDays: number }[] } = {}) {
  const { user, leadType, stage } = await baseFixtures();
  await loginAs(user.id);
  const { company } = await companyWithEligibleContact(user, leadType, stage, "Ready Co", overrides.recipientEmail);
  const list = await createSalesList({ name: "Ready List", purpose: "EMAIL_CAMPAIGN", type: "FIXED", visibility: "PRIVATE" });
  if (!("success" in list)) throw new Error("failed");
  const companyIds = [company.id];
  if (overrides.secondRecipientEmail) {
    const { company: second } = await companyWithEligibleContact(user, leadType, stage, "Second Co", overrides.secondRecipientEmail);
    companyIds.push(second.id);
  }
  await addCompaniesToList(list.id, companyIds);
  const created = await createCampaign({ name: "Ready Campaign", listId: list.id, campaignInstructions: "Mention trivia nights.", steps: overrides.steps ?? ONE_STEP });
  if (!("success" in created)) throw new Error("unreachable");
  await generateCampaignPreview(created.id);
  return { user, company, campaignId: created.id };
}

describe("approveCampaign", () => {
  it("refuses to approve without a connected mailbox", async () => {
    const { campaignId } = await readyCampaign();
    const result = await approveCampaign(campaignId);
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toMatch(/Connect a mailbox/);
  });

  it("approves, sets the approver as sender, and arms the first step", async () => {
    const { user, campaignId } = await readyCampaign();
    await connectMailbox(user.id);

    const result = await approveCampaign(campaignId);
    expect(result).toHaveProperty("success", true);

    const campaign = await testPrisma.campaign.findUniqueOrThrow({ where: { id: campaignId } });
    expect(campaign.status).toBe("APPROVED");
    expect(campaign.senderId).toBe(user.id);
    expect(campaign.approvedById).toBe(user.id);

    const recipient = await testPrisma.campaignRecipient.findFirstOrThrow({ where: { campaignId } });
    expect(recipient.status).toBe("ACTIVE");
    expect(recipient.currentStepId).not.toBeNull();
  });

  it("skips a recipient that turned ineligible since preview, and auto-fails when every recipient is now ineligible", async () => {
    const { user, company, campaignId } = await readyCampaign();
    await connectMailbox(user.id);
    await testPrisma.company.update({ where: { id: company.id }, data: { doNotContact: true } });

    const result = await approveCampaign(campaignId);
    expect(result).toHaveProperty("error");

    const campaign = await testPrisma.campaign.findUniqueOrThrow({ where: { id: campaignId } });
    expect(campaign.status).toBe("FAILED");
  });
});

describe("sendCampaignNow / processDueCampaignStep", () => {
  it("sends the approved campaign, records a SENT step-run, creates a follow-up task, and marks the campaign COMPLETED", async () => {
    const { user, company, campaignId } = await readyCampaign();
    await connectMailbox(user.id);
    await approveCampaign(campaignId);

    const result = await sendCampaignNow(campaignId);
    expect(result).toHaveProperty("success", true);

    await processAllDueSteps(campaignId);

    const recipient = await testPrisma.campaignRecipient.findFirstOrThrow({ where: { campaignId, companyId: company.id } });
    expect(recipient.status).toBe("COMPLETED");
    const stepRun = await testPrisma.campaignRecipientStepRun.findFirstOrThrow({ where: { recipientId: recipient.id } });
    expect(stepRun.status).toBe("SENT");
    expect(stepRun.emailMessageId).not.toBeNull();

    const task = await testPrisma.task.findFirstOrThrow({ where: { companyId: company.id } });
    expect(task.assignedToId).toBe(user.id);
    expect(task.title).toContain("Ready Campaign");

    const campaign = await testPrisma.campaign.findUniqueOrThrow({ where: { id: campaignId } });
    expect(campaign.status).toBe("COMPLETED");
    expect(campaign.completedAt).not.toBeNull();
  });

  it("progresses a two-step sequence only once the second step's wait has passed", async () => {
    const { user, company, campaignId } = await readyCampaign({ steps: [{ waitDays: 0 }, { waitDays: 3 }] });
    await connectMailbox(user.id);
    await approveCampaign(campaignId);
    await sendCampaignNow(campaignId);
    await processAllDueSteps(campaignId);

    let recipient = await testPrisma.campaignRecipient.findFirstOrThrow({ where: { campaignId, companyId: company.id } });
    expect(recipient.status).toBe("ACTIVE");
    expect(recipient.nextStepDueAt!.getTime()).toBeGreaterThan(Date.now());
    expect(await testPrisma.campaignRecipientStepRun.count({ where: { recipientId: recipient.id } })).toBe(1);
    // Campaign isn't done yet — a recipient is still ACTIVE, waiting on step 2.
    expect((await testPrisma.campaign.findUniqueOrThrow({ where: { id: campaignId } })).status).toBe("SENDING");

    // Not due yet — processing now must not advance it.
    await processAllDueSteps(campaignId);
    expect(await testPrisma.campaignRecipientStepRun.count({ where: { recipientId: recipient.id } })).toBe(1);

    // Fast-forward: step 2 becomes due.
    await testPrisma.campaignRecipient.update({ where: { id: recipient.id }, data: { nextStepDueAt: new Date(Date.now() - 1000) } });
    await processAllDueSteps(campaignId);

    recipient = await testPrisma.campaignRecipient.findFirstOrThrow({ where: { campaignId, companyId: company.id } });
    expect(recipient.status).toBe("COMPLETED");
    expect(await testPrisma.campaignRecipientStepRun.count({ where: { recipientId: recipient.id } })).toBe(2);
    expect((await testPrisma.campaign.findUniqueOrThrow({ where: { id: campaignId } })).status).toBe("COMPLETED");
  });

  it("stops a recipient's sequence the moment they become ineligible before a later step", async () => {
    const { user, company, campaignId } = await readyCampaign({ steps: [{ waitDays: 0 }, { waitDays: 3 }] });
    await connectMailbox(user.id);
    await approveCampaign(campaignId);
    await sendCampaignNow(campaignId);
    await processAllDueSteps(campaignId);

    await testPrisma.company.update({ where: { id: company.id }, data: { doNotContact: true } });
    const recipient = await testPrisma.campaignRecipient.findFirstOrThrow({ where: { campaignId, companyId: company.id } });
    await testPrisma.campaignRecipient.update({ where: { id: recipient.id }, data: { nextStepDueAt: new Date(Date.now() - 1000) } });
    await processAllDueSteps(campaignId);

    const stopped = await testPrisma.campaignRecipient.findUniqueOrThrow({ where: { id: recipient.id } });
    expect(stopped.status).toBe("STOPPED_OPT_OUT");
    expect(stopped.stopReason).toBeTruthy();
    // Never attempted step 2 — it was stopped, not sent.
    expect(await testPrisma.campaignRecipientStepRun.count({ where: { recipientId: recipient.id } })).toBe(1);
  });

  it("stops a recipient once their company reaches an admin-chosen stop stage", async () => {
    const otherStage = await testPrisma.pipelineStage.create({ data: { name: "Won", sortOrder: 99, active: true } });
    const { user, company, campaignId } = await readyCampaign({ steps: [{ waitDays: 0 }, { waitDays: 3 }] });
    await testPrisma.campaign.update({ where: { id: campaignId }, data: { stopOnPipelineStageIds: [otherStage.id] } });
    await connectMailbox(user.id);
    await approveCampaign(campaignId);
    await sendCampaignNow(campaignId);
    await processAllDueSteps(campaignId);

    await testPrisma.company.update({ where: { id: company.id }, data: { pipelineStageId: otherStage.id } });
    const recipient = await testPrisma.campaignRecipient.findFirstOrThrow({ where: { campaignId, companyId: company.id } });
    await testPrisma.campaignRecipient.update({ where: { id: recipient.id }, data: { nextStepDueAt: new Date(Date.now() - 1000) } });
    await processAllDueSteps(campaignId);

    const stopped = await testPrisma.campaignRecipient.findUniqueOrThrow({ where: { id: recipient.id } });
    expect(stopped.status).toBe("STOPPED_STAGE");
  });

  it("marks the campaign COMPLETED_WITH_WARNINGS on partial failure, preserving the successful send, and retryFailedRecipients resends only the failed one", async () => {
    const { user, company, campaignId } = await readyCampaign({ secondRecipientEmail: SIMULATED_SEND_FAILURE_ADDRESS });
    await connectMailbox(user.id);
    await approveCampaign(campaignId);
    await sendCampaignNow(campaignId);
    await processAllDueSteps(campaignId);

    let campaign = await testPrisma.campaign.findUniqueOrThrow({ where: { id: campaignId } });
    expect(campaign.status).toBe("COMPLETED_WITH_WARNINGS");

    const okRecipient = await testPrisma.campaignRecipient.findFirstOrThrow({ where: { campaignId, companyId: company.id } });
    expect(okRecipient.status).toBe("COMPLETED");
    const okRun = await testPrisma.campaignRecipientStepRun.findFirstOrThrow({ where: { recipientId: okRecipient.id } });
    expect(okRun.status).toBe("SENT");

    const failedRecipient = await testPrisma.campaignRecipient.findFirstOrThrow({ where: { campaignId, companyId: { not: company.id } } });
    expect(failedRecipient.status).toBe("COMPLETED");
    const failedRun = await testPrisma.campaignRecipientStepRun.findFirstOrThrow({ where: { recipientId: failedRecipient.id } });
    expect(failedRun.status).toBe("FAILED");

    // Fix the underlying problem, then retry — only the failed recipient's
    // step-run should be touched; the earlier successful send is untouched.
    await testPrisma.contact.update({ where: { id: failedRecipient.contactId! }, data: { email: "fixed@example.test" } });
    const retry = await retryFailedRecipients(campaignId);
    expect(retry).toHaveProperty("success", true);
    expect((await testPrisma.campaignRecipientStepRun.findFirstOrThrow({ where: { recipientId: okRecipient.id } })).status).toBe("SENT");

    await processAllDueSteps(campaignId);
    campaign = await testPrisma.campaign.findUniqueOrThrow({ where: { id: campaignId } });
    expect(campaign.status).toBe("COMPLETED");
    expect((await testPrisma.campaignRecipientStepRun.findFirstOrThrow({ where: { recipientId: failedRecipient.id } })).status).toBe("SENT");
  });

  it("hides a private-list campaign entirely from a user who isn't its creator (never found, not just unauthorized)", async () => {
    const { user, campaignId } = await readyCampaign();
    await connectMailbox(user.id);
    await approveCampaign(campaignId);

    const otherRole = await createRoleWithPermissions("OtherSender", ["view_sales_lists", "send_campaigns"]);
    const other = await createTestUser({ roleId: otherRole.id });
    await loginAs(other.id);

    const result = await sendCampaignNow(campaignId);
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toMatch(/not found/);
  });

  it("rejects send-now from a user who can see the campaign but isn't the one who approved it", async () => {
    const team = await createTeam();
    const { user, leadType, stage } = await baseFixtures();
    await testPrisma.user.update({ where: { id: user.id }, data: { teamId: team.id } });
    await loginAs(user.id);
    const { company } = await companyWithEligibleContact(user, leadType, stage, "Team Co");
    const list = await createSalesList({ name: "Team List", purpose: "EMAIL_CAMPAIGN", type: "FIXED", visibility: "SHARED_TEAM" });
    if (!("success" in list)) throw new Error("failed");
    await addCompaniesToList(list.id, [company.id]);
    const created = await createCampaign({ name: "Team Campaign", listId: list.id, campaignInstructions: "Hi.", steps: ONE_STEP });
    if (!("success" in created)) throw new Error("unreachable");
    await generateCampaignPreview(created.id);
    await connectMailbox(user.id);
    await approveCampaign(created.id);

    const otherRole = await createRoleWithPermissions("TeammateSender", ["view_sales_lists", "send_campaigns"]);
    const other = await createTestUser({ roleId: otherRole.id, teamId: team.id });
    await connectMailbox(other.id);
    await loginAs(other.id);

    const result = await sendCampaignNow(created.id);
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toMatch(/approved this campaign/);
  });
});

describe("scheduleCampaign / runSendCampaignTick", () => {
  it("queues a due scheduled campaign once the tick runs", async () => {
    const { user, campaignId } = await readyCampaign();
    await connectMailbox(user.id);
    await approveCampaign(campaignId);

    const future = new Date(Date.now() + 60 * 60 * 1000);
    const scheduled = await scheduleCampaign(campaignId, future.toISOString());
    expect(scheduled).toHaveProperty("success", true);
    expect((await testPrisma.campaign.findUniqueOrThrow({ where: { id: campaignId } })).status).toBe("SCHEDULED");

    // Not due yet — the tick must leave it alone.
    expect(await runSendCampaignTick()).toBe(0);

    await testPrisma.campaign.update({ where: { id: campaignId }, data: { scheduledFor: new Date(Date.now() - 1000) } });
    expect(await runSendCampaignTick()).toBe(1);
    expect((await testPrisma.campaign.findUniqueOrThrow({ where: { id: campaignId } })).status).toBe("QUEUED");
    const recipient = await testPrisma.campaignRecipient.findFirstOrThrow({ where: { campaignId } });
    expect(recipient.nextStepDueAt!.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("rejects a past or invalid schedule date", async () => {
    const { user, campaignId } = await readyCampaign();
    await connectMailbox(user.id);
    await approveCampaign(campaignId);

    const result = await scheduleCampaign(campaignId, new Date(Date.now() - 1000).toISOString());
    expect(result).toHaveProperty("error");
  });
});

describe("cancelCampaign", () => {
  it("cancels still-active recipients and preserves already-sent ones", async () => {
    const { user, company, campaignId } = await readyCampaign({ secondRecipientEmail: "second@example.test", steps: [{ waitDays: 0 }, { waitDays: 3 }] });
    await connectMailbox(user.id);
    await approveCampaign(campaignId);
    await sendCampaignNow(campaignId);
    await processAllDueSteps(campaignId);

    // Both recipients have sent step 1 and are ACTIVE, waiting on step 2.
    const result = await cancelCampaign(campaignId);
    expect(result).toHaveProperty("success", true);

    const recipients = await testPrisma.campaignRecipient.findMany({ where: { campaignId } });
    expect(recipients.every((r) => r.status === "CANCELLED")).toBe(true);
    expect((await testPrisma.campaign.findUniqueOrThrow({ where: { id: campaignId } })).status).toBe("CANCELLED");

    // Step 1's successful send is preserved — never undone by cancellation.
    const company0Recipient = await testPrisma.campaignRecipient.findFirstOrThrow({ where: { campaignId, companyId: company.id } });
    expect(await testPrisma.campaignRecipientStepRun.count({ where: { recipientId: company0Recipient.id, status: "SENT" } })).toBe(1);

    // A worker job that later offers this recipient's step must no-op.
    await processAllDueSteps(campaignId);
    expect(await testPrisma.campaignRecipientStepRun.count({ where: { recipientId: company0Recipient.id } })).toBe(1);
  });
});

describe("CampaignEvent", () => {
  it("records SCHEDULED, QUEUED, and SENT events across the scheduled-send lifecycle", async () => {
    const { user, campaignId } = await readyCampaign();
    await connectMailbox(user.id);
    await approveCampaign(campaignId);

    const future = new Date(Date.now() + 60 * 60 * 1000);
    await scheduleCampaign(campaignId, future.toISOString());
    await testPrisma.campaign.update({ where: { id: campaignId }, data: { scheduledFor: new Date(Date.now() - 1000) } });
    await runSendCampaignTick();
    await processAllDueSteps(campaignId);

    const events = await testPrisma.campaignEvent.findMany({ where: { campaignId }, orderBy: { occurredAt: "asc" } });
    expect(events.map((e) => e.type)).toEqual(["SCHEDULED", "QUEUED", "SENT"]);
    expect(events[2].recipientId).not.toBeNull();
    expect(events[2].stepId).not.toBeNull();
  });

  it("records a FAILED event with the error message in metadata", async () => {
    const { user, campaignId } = await readyCampaign({ recipientEmail: SIMULATED_SEND_FAILURE_ADDRESS });
    await connectMailbox(user.id);
    await approveCampaign(campaignId);
    await sendCampaignNow(campaignId);
    await processAllDueSteps(campaignId);

    const event = await testPrisma.campaignEvent.findFirstOrThrow({ where: { campaignId, type: "FAILED" } });
    expect((event.metadata as { errorMessage: string }).errorMessage).toBeTruthy();
  });

  it("records a SEQUENCE_STOPPED event when a recipient's company reaches an admin-chosen stop stage", async () => {
    const otherStage = await testPrisma.pipelineStage.create({ data: { name: "Won", sortOrder: 99, active: true } });
    const { user, company, campaignId } = await readyCampaign({ steps: [{ waitDays: 0 }, { waitDays: 3 }] });
    await testPrisma.campaign.update({ where: { id: campaignId }, data: { stopOnPipelineStageIds: [otherStage.id] } });
    await connectMailbox(user.id);
    await approveCampaign(campaignId);
    await sendCampaignNow(campaignId);
    await processAllDueSteps(campaignId);

    await testPrisma.company.update({ where: { id: company.id }, data: { pipelineStageId: otherStage.id } });
    const recipient = await testPrisma.campaignRecipient.findFirstOrThrow({ where: { campaignId, companyId: company.id } });
    await testPrisma.campaignRecipient.update({ where: { id: recipient.id }, data: { nextStepDueAt: new Date(Date.now() - 1000) } });
    await processAllDueSteps(campaignId);

    const event = await testPrisma.campaignEvent.findFirstOrThrow({ where: { campaignId, recipientId: recipient.id, type: "SEQUENCE_STOPPED" } });
    expect(event).toBeTruthy();
  });
});
