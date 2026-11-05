import { describe, it, expect } from "vitest";
import { googleMapsHref } from "../../src/lib/maps";

describe("googleMapsHref", () => {
  it("searches Google Maps for the business name and address", () => {
    expect(googleMapsHref("O'Malley's & Co", "45 Main St E", "Milton", "ON", null)).toBe(
      "https://www.google.com/maps/search/?api=1&query=O'Malley's%20%26%20Co%2C%2045%20Main%20St%20E%2C%20Milton%2C%20ON",
    );
  });

  it("gives no link without an address", () => {
    expect(googleMapsHref("Pub", "  ", null, undefined)).toBeNull();
  });
});
