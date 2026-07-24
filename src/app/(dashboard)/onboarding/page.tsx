import { getOnboardingChecklist } from "./actions";
import { OnboardingChecklist } from "./onboarding-checklist";
import { PageHeader } from "@/components/ui/page-header";

export const metadata = { title: "Getting Started — Triviality CRM" };

export default async function OnboardingPage() {
  const { items } = await getOnboardingChecklist();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        title="Getting started"
        description="A quick checklist to help you get set up. Check items off as you go — nothing here is required to use the CRM, and you can come back to this anytime."
      />
      <OnboardingChecklist items={items} />
    </div>
  );
}
