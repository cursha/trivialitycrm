import { z } from "zod";
import { RADIUS_BOUNDS } from "../geo/distance";

export const DistanceUnitValues = ["MI", "KM"] as const;

// Bounds are unit-dependent (RADIUS_BOUNDS from src/lib/geo/distance.ts,
// shared with the form's min/max inputs) — validated via .superRefine below
// rather than a static z.number().min/max(), since the valid range itself
// depends on which unit was chosen.
export const PubRadiusSetupSchema = z
  .object({
    originCompanyId: z.string().min(1, { error: "Choose a pub to search around." }),
    radiusValue: z.coerce.number().int({ error: "Enter a whole number radius." }),
    radiusUnit: z.enum(DistanceUnitValues).default("MI"),
  })
  .superRefine((data, ctx) => {
    const bounds = RADIUS_BOUNDS[data.radiusUnit];
    if (data.radiusValue < bounds.min || data.radiusValue > bounds.max) {
      ctx.addIssue({
        code: "custom",
        path: ["radiusValue"],
        message: `Radius must be between ${bounds.min} and ${bounds.max} ${data.radiusUnit.toLowerCase()}.`,
      });
    }
  });

export type PubRadiusSetupValues = z.infer<typeof PubRadiusSetupSchema>;
