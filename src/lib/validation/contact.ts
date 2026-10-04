import { z } from "zod";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .or(z.literal(""))
    .transform((value) => (value ? value : undefined));

export const ContactSchema = z.object({
  firstName: z.string().trim().min(1, { error: "Enter a first name." }).max(100),
  lastName: z.string().trim().min(1, { error: "Enter a last name." }).max(100),
  title: optionalText(120),
  phone: optionalText(40),
  email: z
    .union([z.email({ error: "Enter a valid email." }), z.literal("")])
    .optional()
    .transform((value) => (value ? value : undefined)),
  bestTimeToReach: optionalText(120),
  // Checkbox semantics: "on" when ticked, absent (empty string) otherwise.
  isDecisionMaker: z
    .string()
    .optional()
    .transform((value) => value === "on"),
  isChampion: z
    .string()
    .optional()
    .transform((value) => value === "on"),
});
