const LABELS = { TRIVIA: "trivia", KARAOKE: "karaoke" } as const;

/** "trivia", "karaoke", or "trivia and/or karaoke" — what a Quick Search was
 * narrowed to. Empty string when it wasn't. */
export function describeEntertainment(values: readonly (keyof typeof LABELS)[]): string {
  return values.map((value) => LABELS[value]).join(" and/or ");
}
