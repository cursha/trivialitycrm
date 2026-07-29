// Fixes the inconsistent casing lead-gen sources hand back for city names
// (all-caps directory exports, all-lowercase AI research output) without
// clobbering names that are already correctly mixed-case, like "McAllen" or
// "DeKalb" — a word left as-is if it already mixes upper/lower case,
// otherwise capitalized-first/lowercased-rest.
function normalizeWordCase(word: string): string {
  if (/[a-z]/.test(word) && /[A-Z]/.test(word)) return word;
  const lower = word.toLowerCase();
  return lower.length > 0 ? lower[0].toUpperCase() + lower.slice(1) : lower;
}

/** Title-cases a city name word-by-word, splitting on both spaces and hyphens (e.g. "winston-salem" -> "Winston-Salem"). */
export function titleCaseCity(value: string): string {
  return value
    .split(" ")
    .map((segment) => segment.split("-").map(normalizeWordCase).join("-"))
    .join(" ");
}
