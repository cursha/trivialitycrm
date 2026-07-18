import { z } from "zod";

export const CreateUserSchema = z.object({
  name: z.string().trim().min(1, { error: "Enter a name." }).max(120),
  email: z.email({ error: "Enter a valid email." }),
  roleId: z.string().min(1, { error: "Choose a role." }),
  teamId: z.string().optional(),
  initialPassword: z
    .string()
    .min(8, { error: "Must be at least 8 characters." })
    .regex(/[a-zA-Z]/, { error: "Must contain at least one letter." })
    .regex(/[0-9]/, { error: "Must contain at least one number." })
    .regex(/[^a-zA-Z0-9]/, { error: "Must contain at least one special character." }),
});
