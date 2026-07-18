import { z } from "zod";

export const LoginSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

export const ChangePasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: z
      .string()
      .min(8, { error: "Must be at least 8 characters." })
      .regex(/[a-zA-Z]/, { error: "Must contain at least one letter." })
      .regex(/[0-9]/, { error: "Must contain at least one number." })
      .regex(/[^a-zA-Z0-9]/, { error: "Must contain at least one special character." }),
    confirmPassword: z.string().min(1),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    error: "Passwords do not match.",
    path: ["confirmPassword"],
  });
