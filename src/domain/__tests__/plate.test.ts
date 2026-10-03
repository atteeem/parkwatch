import { createPlateNumber, MVP_MOCK_DETECTED_VEHICLE, normalizePlate, platesMatch } from "./testHelpers";

describe("plate normalization", () => {
  it.each(["ABC-123", "abc-123", "ABC 123", "abc123", "  abc - 123 "])("%p normalizes to ABC123", (raw) => {
    expect(normalizePlate(raw)).toBe("ABC123");
  });

  it("does not bake any national display format into the normalized key", () => {
    expect(normalizePlate("GHC-789")).toBe("GHC789");
    expect(normalizePlate("AB 12 CDE")).toBe("AB12CDE");
    expect(normalizePlate("b.123.cd")).toBe("B123CD");
  });

  it("the value object keeps the display form as raw", () => {
    expect(createPlateNumber(" ABC-123 ", "fi")).toEqual({ raw: "ABC-123", normalized: "ABC123", country: "FI" });
    expect(createPlateNumber("abc123")).toEqual({ raw: "abc123", normalized: "ABC123" });
  });

  it("matching uses the normalized key; an unknown country is not a mismatch", () => {
    expect(platesMatch(createPlateNumber("ABC-123", "FI"), createPlateNumber("abc 123"))).toBe(true);
    expect(platesMatch(createPlateNumber("ABC-123", "FI"), createPlateNumber("ABC123", "SE"))).toBe(false);
    expect(platesMatch(createPlateNumber("ABC-123"), createPlateNumber("ABC-124"))).toBe(false);
    expect(platesMatch(createPlateNumber(" "), createPlateNumber(""))).toBe(false);
  });

  it("the centralized mock vehicle carries a plate value object", () => {
    expect(MVP_MOCK_DETECTED_VEHICLE.plate).toEqual({ raw: "GHC-789", normalized: "GHC789", country: "FI" });
  });
});
