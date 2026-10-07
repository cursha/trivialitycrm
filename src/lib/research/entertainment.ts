const LABELS = { TRIVIA: "trivia", KARAOKE: "karaoke", BINGO: "bingo", EVENTS: "events" } as const;

const VENUE_KIND_LABELS = { PUB: "pubs", BAR: "bars", TAVERN: "taverns" } as const;

/** "pubs", "pubs, bars, taverns" — what a Quick Search asked the directory
 * for. Empty string when it used the Lead Type's own name. */
export function describeVenueKinds(values: readonly (keyof typeof VENUE_KIND_LABELS)[]): string {
  return values.map((value) => VENUE_KIND_LABELS[value]).join(", ");
}

/** "trivia", "karaoke", "bingo", "events", or e.g. "trivia and/or karaoke" — what a Quick Search was
 * narrowed to. Empty string when it wasn't. */
export function describeEntertainment(values: readonly (keyof typeof LABELS)[]): string {
  return values.map((value) => LABELS[value]).join(" and/or ");
}
