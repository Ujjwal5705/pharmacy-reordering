import { describe, expect, it } from "vitest";
import { addressWithArea, withFullStop } from "@/lib/format";

describe("display helpers", () => {
  it("adds a full stop to a pharmacist's reason only when it has none", () => {
    expect(withFullStop("Strength still not readable. Please get a fresh prescription")).toBe(
      "Strength still not readable. Please get a fresh prescription.",
    );
    expect(withFullStop("Not on the prescription.  ")).toBe("Not on the prescription.");
    expect(withFullStop("Is this yours?")).toBe("Is this yours?");
  });

  it("does not repeat the delivery area when the address already names it", () => {
    expect(addressWithArea("Flat 4B, Sector II, Salt Lake", "Salt Lake")).toBe("Flat 4B, Sector II, Salt Lake");
    expect(addressWithArea("22 Sample Para", "Behala")).toBe("22 Sample Para, Behala");
  });
});
