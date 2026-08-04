// Standalone region lists for Competition Locator's start form and its
// "leave blank = search broadly" region expansion. Deliberately NOT sourced
// from src/lib/data-quality/normalize.ts's private US_STATES/CA_PROVINCES
// maps (name -> code lookups, not ordered {code,label} lists, and not
// exported) — kept separate so nothing here can regress that module's
// matching behavior, per this file's own single purpose.
//
// Per the "Canada and United States only, no Mexico/territories" scope:
// Yukon, Northwest Territories, and Nunavut are excluded from CA_PROVINCES.
export type RegionOption = { code: string; label: string; country: "United States" | "Canada" };

export const US_STATES: RegionOption[] = [
  { code: "AL", label: "Alabama", country: "United States" },
  { code: "AK", label: "Alaska", country: "United States" },
  { code: "AZ", label: "Arizona", country: "United States" },
  { code: "AR", label: "Arkansas", country: "United States" },
  { code: "CA", label: "California", country: "United States" },
  { code: "CO", label: "Colorado", country: "United States" },
  { code: "CT", label: "Connecticut", country: "United States" },
  { code: "DE", label: "Delaware", country: "United States" },
  { code: "FL", label: "Florida", country: "United States" },
  { code: "GA", label: "Georgia", country: "United States" },
  { code: "HI", label: "Hawaii", country: "United States" },
  { code: "ID", label: "Idaho", country: "United States" },
  { code: "IL", label: "Illinois", country: "United States" },
  { code: "IN", label: "Indiana", country: "United States" },
  { code: "IA", label: "Iowa", country: "United States" },
  { code: "KS", label: "Kansas", country: "United States" },
  { code: "KY", label: "Kentucky", country: "United States" },
  { code: "LA", label: "Louisiana", country: "United States" },
  { code: "ME", label: "Maine", country: "United States" },
  { code: "MD", label: "Maryland", country: "United States" },
  { code: "MA", label: "Massachusetts", country: "United States" },
  { code: "MI", label: "Michigan", country: "United States" },
  { code: "MN", label: "Minnesota", country: "United States" },
  { code: "MS", label: "Mississippi", country: "United States" },
  { code: "MO", label: "Missouri", country: "United States" },
  { code: "MT", label: "Montana", country: "United States" },
  { code: "NE", label: "Nebraska", country: "United States" },
  { code: "NV", label: "Nevada", country: "United States" },
  { code: "NH", label: "New Hampshire", country: "United States" },
  { code: "NJ", label: "New Jersey", country: "United States" },
  { code: "NM", label: "New Mexico", country: "United States" },
  { code: "NY", label: "New York", country: "United States" },
  { code: "NC", label: "North Carolina", country: "United States" },
  { code: "ND", label: "North Dakota", country: "United States" },
  { code: "OH", label: "Ohio", country: "United States" },
  { code: "OK", label: "Oklahoma", country: "United States" },
  { code: "OR", label: "Oregon", country: "United States" },
  { code: "PA", label: "Pennsylvania", country: "United States" },
  { code: "RI", label: "Rhode Island", country: "United States" },
  { code: "SC", label: "South Carolina", country: "United States" },
  { code: "SD", label: "South Dakota", country: "United States" },
  { code: "TN", label: "Tennessee", country: "United States" },
  { code: "TX", label: "Texas", country: "United States" },
  { code: "UT", label: "Utah", country: "United States" },
  { code: "VT", label: "Vermont", country: "United States" },
  { code: "VA", label: "Virginia", country: "United States" },
  { code: "WA", label: "Washington", country: "United States" },
  { code: "WV", label: "West Virginia", country: "United States" },
  { code: "WI", label: "Wisconsin", country: "United States" },
  { code: "WY", label: "Wyoming", country: "United States" },
  { code: "DC", label: "District of Columbia", country: "United States" },
];

export const CA_PROVINCES: RegionOption[] = [
  { code: "AB", label: "Alberta", country: "Canada" },
  { code: "BC", label: "British Columbia", country: "Canada" },
  { code: "MB", label: "Manitoba", country: "Canada" },
  { code: "NB", label: "New Brunswick", country: "Canada" },
  { code: "NL", label: "Newfoundland and Labrador", country: "Canada" },
  { code: "NS", label: "Nova Scotia", country: "Canada" },
  { code: "ON", label: "Ontario", country: "Canada" },
  { code: "PE", label: "Prince Edward Island", country: "Canada" },
  { code: "QC", label: "Quebec", country: "Canada" },
  { code: "SK", label: "Saskatchewan", country: "Canada" },
];

export const ALL_NORTH_AMERICAN_REGIONS: RegionOption[] = [...US_STATES, ...CA_PROVINCES];
