import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import { createRoleWithPermissions, createTestUser, createPromptTemplateFixture, loginAs } from "../helpers/fixtures";
import { resetFakeCookies, RedirectSignal } from "../setup/mock-next";
import { createPrompt, updatePrompt, duplicatePrompt, archivePrompt, restorePrompt, refinePrompt } from "../../src/app/(dashboard)/leads/prompts/actions";

beforeEach(async () => {
  await resetDatabase();
  resetFakeCookies();
});

async function baseFixtures() {
  const managerRole = await createRoleWithPermissions("PromptManager", ["manage_prompts"]);
  const viewerRole = await createRoleWithPermissions("Viewer", ["view_all_leads"]);
  const manager = await createTestUser({ name: "Manager", roleId: managerRole.id });
  const viewer = await createTestUser({ name: "Viewer", roleId: viewerRole.id });
  return { manager, viewer };
}

function promptFormData(overrides: Record<string, string> = {}) {
  const fd = new FormData();
  const defaults = { name: "Trivia Gap Finder", qualificationPrompt: "Bars with events but no trivia." };
  for (const [key, value] of Object.entries({ ...defaults, ...overrides })) fd.set(key, value);
  return fd;
}

describe("prompt management", () => {
  it("creates a prompt and redirects to the list", async () => {
    const { manager } = await baseFixtures();
    await loginAs(manager.id);

    let redirectUrl: string | undefined;
    try {
      await createPrompt(undefined, promptFormData());
      expect.fail("expected redirect");
    } catch (error) {
      redirectUrl = (error as RedirectSignal).url;
    }

    expect(redirectUrl).toBe("/leads/prompts");
    const prompt = await testPrisma.promptTemplate.findFirstOrThrow({ where: { name: "Trivia Gap Finder" } });
    expect(prompt.createdById).toBe(manager.id);
    expect(prompt.archived).toBe(false);
  });

  it("blocks creation without manage_prompts", async () => {
    const { viewer } = await baseFixtures();
    await loginAs(viewer.id);

    await expect(createPrompt(undefined, promptFormData())).rejects.toThrow(/Forbidden/);
  });

  it("updates a prompt's text", async () => {
    const { manager } = await baseFixtures();
    await loginAs(manager.id);
    const prompt = await createPromptTemplateFixture({ createdById: manager.id });

    try {
      await updatePrompt(prompt.id, undefined, promptFormData({ qualificationPrompt: "Updated criteria." }));
    } catch {
      // redirect throws — expected
    }

    const updated = await testPrisma.promptTemplate.findUniqueOrThrow({ where: { id: prompt.id } });
    expect(updated.qualificationPrompt).toBe("Updated criteria.");
  });

  it("duplicates a prompt independently of the original", async () => {
    const { manager } = await baseFixtures();
    await loginAs(manager.id);
    const prompt = await createPromptTemplateFixture({ createdById: manager.id, name: "Original" });

    await duplicatePrompt(prompt.id);

    const copy = await testPrisma.promptTemplate.findFirstOrThrow({ where: { name: "Original (copy)" } });
    expect(copy.id).not.toBe(prompt.id);
    expect(copy.qualificationPrompt).toBe(prompt.qualificationPrompt);
  });

  it("archives and restores a prompt", async () => {
    const { manager } = await baseFixtures();
    await loginAs(manager.id);
    const prompt = await createPromptTemplateFixture({ createdById: manager.id });

    await archivePrompt(prompt.id);
    expect((await testPrisma.promptTemplate.findUniqueOrThrow({ where: { id: prompt.id } })).archived).toBe(true);

    await restorePrompt(prompt.id);
    expect((await testPrisma.promptTemplate.findUniqueOrThrow({ where: { id: prompt.id } })).archived).toBe(false);
  });

  it("refines a prompt via the mock AI provider", async () => {
    const { manager } = await baseFixtures();
    await loginAs(manager.id);

    const fd = new FormData();
    fd.set("description", "Focus on independently-owned pubs.");
    fd.set("currentPrompt", "Bars with events.");

    const result = await refinePrompt(undefined, fd);
    expect(result?.error).toBeUndefined();
    expect(result?.prompt).toContain("Bars with events.");
  });
});
