import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import { createRoleWithPermissions, createTestUser, createLeadTypeFixture, createEmailTemplateCategoryFixture, loginAs } from "../helpers/fixtures";
import { resetFakeCookies } from "../setup/mock-next";
import {
  createEmailTemplate,
  updateEmailTemplate,
  setEmailTemplateActive,
  deleteEmailTemplate,
  addEmailTemplateLink,
  removeEmailTemplateLink,
} from "../../src/app/(dashboard)/settings/email-templates/actions";

beforeEach(async () => {
  await resetDatabase();
  resetFakeCookies();
});

function baseFormData(overrides: Record<string, string> = {}) {
  const formData = new FormData();
  formData.set("name", overrides.name ?? "Intro follow-up");
  formData.set("categoryId", overrides.categoryId ?? "");
  formData.set("subject", overrides.subject ?? "Hi {{contact.firstName}}");
  formData.set("body", overrides.body ?? "Thanks for your interest, {{contact.firstName}}. Unsubscribe: {{unsubscribeLink}}");
  formData.set("visibility", overrides.visibility ?? "PERSONAL");
  formData.set("leadTypeId", overrides.leadTypeId ?? "");
  formData.set("pipelineStageId", overrides.pipelineStageId ?? "");
  formData.set("language", overrides.language ?? "en");
  formData.set("active", overrides.active ?? "on");
  return formData;
}

describe("createEmailTemplate", () => {
  it("blocks a user without manage_personal_templates from creating a personal template", async () => {
    const role = await createRoleWithPermissions("NoTemplates", ["view_assigned_leads"]);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);

    await expect(createEmailTemplate(undefined, baseFormData())).rejects.toThrow(/Forbidden/);
  });

  it("blocks a user without manage_shared_templates from creating a shared template", async () => {
    const role = await createRoleWithPermissions("PersonalOnly", ["manage_personal_templates"]);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);

    await expect(createEmailTemplate(undefined, baseFormData({ visibility: "SHARED" }))).rejects.toThrow(/Forbidden/);
  });

  it("creates a personal template owned by the creator", async () => {
    const role = await createRoleWithPermissions("Personal", ["manage_personal_templates"]);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);

    const result = await createEmailTemplate(undefined, baseFormData());
    expect(result).toBeUndefined();

    const template = await testPrisma.emailTemplate.findFirstOrThrow({ where: { name: "Intro follow-up" } });
    expect(template.visibility).toBe("PERSONAL");
    expect(template.ownerId).toBe(user.id);
    expect(template.createdById).toBe(user.id);
  });

  it("creates a shared template with no owner when the creator manages shared templates", async () => {
    const role = await createRoleWithPermissions("Shared", ["manage_personal_templates", "manage_shared_templates"]);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);

    await createEmailTemplate(undefined, baseFormData({ visibility: "SHARED" }));

    const template = await testPrisma.emailTemplate.findFirstOrThrow({ where: { name: "Intro follow-up" } });
    expect(template.visibility).toBe("SHARED");
    expect(template.ownerId).toBeNull();
  });

  it("rejects a template referencing an unknown placeholder token instead of saving it", async () => {
    const role = await createRoleWithPermissions("Personal", ["manage_personal_templates"]);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);

    const result = await createEmailTemplate(undefined, baseFormData({ body: "Hi {{contact.nickname}}" }));
    expect(result?.error).toMatch(/contact\.nickname/);
    expect(await testPrisma.emailTemplate.count()).toBe(0);
  });

  it("rejects a template whose body is missing the mandatory unsubscribe placeholder", async () => {
    const role = await createRoleWithPermissions("Personal", ["manage_personal_templates"]);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);

    const result = await createEmailTemplate(undefined, baseFormData({ body: "Thanks for your interest, {{contact.firstName}}." }));
    expect(result?.error).toMatch(/unsubscribeLink/);
    expect(await testPrisma.emailTemplate.count()).toBe(0);
  });

  it("links a template to a lead type when provided", async () => {
    const role = await createRoleWithPermissions("Personal", ["manage_personal_templates"]);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);
    const leadType = await createLeadTypeFixture();

    await createEmailTemplate(undefined, baseFormData({ leadTypeId: leadType.id }));

    const template = await testPrisma.emailTemplate.findFirstOrThrow({ where: { name: "Intro follow-up" } });
    expect(template.leadTypeId).toBe(leadType.id);
  });

  it("links a template to a category when provided", async () => {
    const role = await createRoleWithPermissions("Personal", ["manage_personal_templates"]);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);
    const category = await createEmailTemplateCategoryFixture(user.id);

    await createEmailTemplate(undefined, baseFormData({ categoryId: category.id }));

    const template = await testPrisma.emailTemplate.findFirstOrThrow({ where: { name: "Intro follow-up" } });
    expect(template.categoryId).toBe(category.id);
  });
});

describe("updateEmailTemplate / setEmailTemplateActive / deleteEmailTemplate", () => {
  it("lets the owner edit their own personal template", async () => {
    const role = await createRoleWithPermissions("Personal", ["manage_personal_templates"]);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);
    await createEmailTemplate(undefined, baseFormData());
    const template = await testPrisma.emailTemplate.findFirstOrThrow({ where: { name: "Intro follow-up" } });

    const result = await updateEmailTemplate(template.id, undefined, baseFormData({ name: "Renamed" }));
    expect(result).toBeUndefined();
    expect((await testPrisma.emailTemplate.findUniqueOrThrow({ where: { id: template.id } })).name).toBe("Renamed");
  });

  it("blocks a different user (even with manage_personal_templates) from editing someone else's personal template", async () => {
    const role = await createRoleWithPermissions("Personal", ["manage_personal_templates"]);
    const owner = await createTestUser({ roleId: role.id });
    const otherUser = await createTestUser({ roleId: role.id });

    await loginAs(owner.id);
    await createEmailTemplate(undefined, baseFormData());
    const template = await testPrisma.emailTemplate.findFirstOrThrow({ where: { name: "Intro follow-up" } });

    await loginAs(otherUser.id);
    await expect(updateEmailTemplate(template.id, undefined, baseFormData({ name: "Hijacked" }))).rejects.toThrow(/own personal templates/);
  });

  it("lets a shared-template manager edit someone else's personal template as an administrative override", async () => {
    const personalRole = await createRoleWithPermissions("Personal", ["manage_personal_templates"]);
    const owner = await createTestUser({ roleId: personalRole.id });
    const adminRole = await createRoleWithPermissions("Admin", ["manage_personal_templates", "manage_shared_templates"]);
    const admin = await createTestUser({ roleId: adminRole.id });

    await loginAs(owner.id);
    await createEmailTemplate(undefined, baseFormData());
    const template = await testPrisma.emailTemplate.findFirstOrThrow({ where: { name: "Intro follow-up" } });

    await loginAs(admin.id);
    await updateEmailTemplate(template.id, undefined, baseFormData({ name: "Cleaned up" }));
    expect((await testPrisma.emailTemplate.findUniqueOrThrow({ where: { id: template.id } })).name).toBe("Cleaned up");
  });

  it("blocks a user without manage_shared_templates from editing a shared template", async () => {
    const adminRole = await createRoleWithPermissions("Admin", ["manage_personal_templates", "manage_shared_templates"]);
    const admin = await createTestUser({ roleId: adminRole.id });
    await loginAs(admin.id);
    await createEmailTemplate(undefined, baseFormData({ visibility: "SHARED" }));
    const template = await testPrisma.emailTemplate.findFirstOrThrow({ where: { name: "Intro follow-up" } });

    const personalRole = await createRoleWithPermissions("Personal", ["manage_personal_templates"]);
    const otherUser = await createTestUser({ roleId: personalRole.id });
    await loginAs(otherUser.id);

    await expect(updateEmailTemplate(template.id, undefined, baseFormData({ visibility: "SHARED", name: "Hijacked" }))).rejects.toThrow(
      /Forbidden/,
    );
  });

  it("toggles active and deletes, both permission-gated to the owner", async () => {
    const role = await createRoleWithPermissions("Personal", ["manage_personal_templates"]);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);
    await createEmailTemplate(undefined, baseFormData());
    const template = await testPrisma.emailTemplate.findFirstOrThrow({ where: { name: "Intro follow-up" } });

    await setEmailTemplateActive(template.id, false);
    expect((await testPrisma.emailTemplate.findUniqueOrThrow({ where: { id: template.id } })).active).toBe(false);

    await deleteEmailTemplate(template.id);
    expect(await testPrisma.emailTemplate.count({ where: { id: template.id } })).toBe(0);
  });
});

describe("addEmailTemplateLink / removeEmailTemplateLink", () => {
  it("adds a link and removes it again, gated by the same edit access as the template", async () => {
    const role = await createRoleWithPermissions("Personal", ["manage_personal_templates"]);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);
    await createEmailTemplate(undefined, baseFormData());
    const template = await testPrisma.emailTemplate.findFirstOrThrow({ where: { name: "Intro follow-up" } });

    const linkFormData = new FormData();
    linkFormData.set("label", "Menu");
    linkFormData.set("url", "https://drive.google.com/menu");
    const result = await addEmailTemplateLink(template.id, undefined, linkFormData);
    expect(result?.error).toBeUndefined();

    const link = await testPrisma.emailTemplateLink.findFirstOrThrow({ where: { emailTemplateId: template.id } });
    expect(link.label).toBe("Menu");
    expect(link.url).toBe("https://drive.google.com/menu");

    await removeEmailTemplateLink(template.id, link.id);
    expect(await testPrisma.emailTemplateLink.count({ where: { emailTemplateId: template.id } })).toBe(0);
  });

  it("rejects a non-http(s) URL", async () => {
    const role = await createRoleWithPermissions("Personal", ["manage_personal_templates"]);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);
    await createEmailTemplate(undefined, baseFormData());
    const template = await testPrisma.emailTemplate.findFirstOrThrow({ where: { name: "Intro follow-up" } });

    const linkFormData = new FormData();
    linkFormData.set("label", "Bad");
    linkFormData.set("url", "javascript:alert(1)");
    const result = await addEmailTemplateLink(template.id, undefined, linkFormData);
    expect(result?.error).toMatch(/http/i);
    expect(await testPrisma.emailTemplateLink.count({ where: { emailTemplateId: template.id } })).toBe(0);
  });

  it("blocks a different user from adding a link to someone else's personal template", async () => {
    const role = await createRoleWithPermissions("Personal", ["manage_personal_templates"]);
    const owner = await createTestUser({ roleId: role.id });
    const otherUser = await createTestUser({ roleId: role.id });

    await loginAs(owner.id);
    await createEmailTemplate(undefined, baseFormData());
    const template = await testPrisma.emailTemplate.findFirstOrThrow({ where: { name: "Intro follow-up" } });

    await loginAs(otherUser.id);
    const linkFormData = new FormData();
    linkFormData.set("label", "Menu");
    linkFormData.set("url", "https://drive.google.com/menu");
    await expect(addEmailTemplateLink(template.id, undefined, linkFormData)).rejects.toThrow(/own personal templates/);
  });
});
