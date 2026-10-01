import { describe, expect, it } from "vitest";
import { parseNtTag } from "./nt-tag.js";

describe("parseNtTag", () => {
  it("reads a phone and an optional service code", () => {
    const parsed = parseNtTag("לק\n[NT:052-123-4567:NAILS]\nמקור: שירה");
    expect(parsed).toEqual({
      phone: "+972521234567",
      serviceCode: "NAILS",
      bookedByAi: true,
    });
  });

  it("returns null when the phone is not valid", () => {
    expect(parseNtTag("[NT:12]")).toBeNull();
  });
});
