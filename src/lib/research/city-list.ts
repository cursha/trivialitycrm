// The Quick Search cities box: a pasted list, one city per line or separated
// by commas. No server imports, used by the form in the browser too.

/**
 * The cities in a pasted list, in order, without blanks or repeats (any
 * case). One per line when the text has line breaks, so "Milton, ON" on its
 * own line is read as Milton (anything after the first comma is dropped);
 * otherwise split on commas and semicolons.
 */
export function parseCityList(text: string): string[] {
  const lines = /\r?\n/.test(text.trim()) ? text.split(/\r?\n/).map((line) => line.split(",")[0]) : text.split(/[,;]/);
  const seen = new Set<string>();
  const cities: string[] = [];
  for (const raw of lines) {
    const city = raw.replace(/\s+/g, " ").trim();
    if (!city || seen.has(city.toLowerCase())) continue;
    seen.add(city.toLowerCase());
    cities.push(city);
  }
  return cities;
}
