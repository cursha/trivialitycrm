import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import { createRoleWithPermissions, createTestUser, loginAs } from "../helpers/fixtures";
import { resetFakeCookies } from "../setup/mock-next";
import { createPipelineStage, setPipelineStageOutcome } from "../../src/app/(dashboard)/settings/pipeline-stages/actions";

beforeEach(async () => {
  await resetDatabase();
  resetFakeCookies();
});

async function adminFixture() {
  const role = await createRoleWithPermissions("Administrator", ["manage_settings"]);
  const admin = await createTestUser({ roleId: role.id });
  await loginAs(admin.id);
  return admin;
}

function formData(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe("Pipeline stage outcome (Won/Lost)", () => {
  it("creates a stage with no outcome (open) when the outcome field is left blank", async () => {
    await adminFixture();

    const result = await createPipelineStage(undefined, formData({ name: "Contacted" }));
    expect(result?.error).toBeUndefined();

    const stage = await testPrisma.pipelineStage.findFirstOrThrow({ where: { name: "Contacted" } });
    expect(stage.outcomeType).toBeNull();
  });

  it("creates a stage tagged Lost when the outcome field is set at creation", async () => {
    await adminFixture();

    const result = await createPipelineStage(undefined, formData({ name: "Not a Fit", outcomeType: "LOST" }));
    expect(result?.error).toBeUndefined();

    const stage = await testPrisma.pipelineStage.findFirstOrThrow({ where: { name: "Not a Fit" } });
    expect(stage.outcomeType).toBe("LOST");
  });

  it("rejects a malformed outcome value rather than silently defaulting to open", async () => {
    await adminFixture();

    const result = await createPipelineStage(undefined, formData({ name: "Bogus Stage", outcomeType: "MAYBE" }));
    expect(result?.error).toBeTruthy();
    expect(await testPrisma.pipelineStage.findFirst({ where: { name: "Bogus Stage" } })).toBeNull();
  });

  it("lets an existing stage's outcome be changed after creation, including back to open", async () => {
    await adminFixture();
    await createPipelineStage(undefined, formData({ name: "Demo Scheduled" }));
    const stage = await testPrisma.pipelineStage.findFirstOrThrow({ where: { name: "Demo Scheduled" } });
    expect(stage.outcomeType).toBeNull();

    await setPipelineStageOutcome(stage.id, "WON");
    expect((await testPrisma.pipelineStage.findUniqueOrThrow({ where: { id: stage.id } })).outcomeType).toBe("WON");

    await setPipelineStageOutcome(stage.id, null);
    expect((await testPrisma.pipelineStage.findUniqueOrThrow({ where: { id: stage.id } })).outcomeType).toBeNull();
  });

  it("requires manage_settings for both creating and re-tagging a stage's outcome", async () => {
    const role = await createRoleWithPermissions("Limited", ["view_all_leads"]);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);

    await expect(createPipelineStage(undefined, formData({ name: "Whatever", outcomeType: "LOST" }))).rejects.toThrow();
    await expect(setPipelineStageOutcome("nonexistent-id", "LOST")).rejects.toThrow();
  });
});
