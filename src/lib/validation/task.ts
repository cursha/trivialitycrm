import { z } from "zod";

export const TaskSchema = z.object({
  title: z.string().trim().min(1, { error: "Enter a title." }).max(200),
  notes: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .or(z.literal(""))
    .transform((value) => (value ? value : undefined)),
  dueAt: z.string().min(1, { error: "Choose a due date." }),
  assignedToId: z.string().min(1, { error: "Choose a salesperson." }),
});
