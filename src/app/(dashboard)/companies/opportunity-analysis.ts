"use server";

import { runOpportunityAnalysis, type AnalyzeOpportunityResult } from "@/lib/companies/analyze-opportunity";

export type { AnalyzeOpportunityResult };

/**
 * Thin Server Action wrapper, kept for programmatic/test callers that just
 * want the final result with no progress reporting. The real UI path
 * (opportunity-analysis-panel.tsx) calls the streaming Route Handler at
 * src/app/api/companies/[id]/analyze-opportunity/route.ts instead — see
 * runOpportunityAnalysis()'s own doc comment (src/lib/companies/
 * analyze-opportunity.ts) for why a plain Server Action isn't used there.
 */
export async function analyzeCompanyOpportunity(companyId: string): Promise<AnalyzeOpportunityResult> {
  return runOpportunityAnalysis(companyId);
}
