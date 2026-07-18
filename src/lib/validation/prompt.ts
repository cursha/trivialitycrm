import { z } from "zod";

export const PromptTemplateSchema = z.object({
  name: z.string().trim().min(1, { error: "Enter a name for this prompt." }).max(150),
  qualificationPrompt: z.string().trim().min(1, { error: "Enter the research prompt text." }).max(8000),
});

export type PromptTemplateFormValues = z.infer<typeof PromptTemplateSchema>;

export const PromptRefineSchema = z.object({
  description: z.string().trim().min(1, { error: "Describe what you want the AI to research or improve." }).max(2000),
  currentPrompt: z.string().trim().max(8000).optional(),
});
