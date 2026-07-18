import { z } from "zod";

export const LookupNameSchema = z.object({
  name: z.string().trim().min(1, { error: "Enter a name." }).max(120),
});
