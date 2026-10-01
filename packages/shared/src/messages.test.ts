import { describe, expect, it } from "vitest";
import { MESSAGE_DEFAULTS, withFirstName } from "./messages.js";

describe("messages", () => {
  it("never starts a default with היי", () => {
    for (const text of Object.values(MESSAGE_DEFAULTS)) {
      expect(text.startsWith("היי")).toBe(false);
    }
  });

  it("puts the first name at the start and drops it when missing", () => {
    expect(withFirstName("{שם}, עוד מעט", "רחל כהן", {})).toBe("רחל, עוד מעט");
    expect(withFirstName("{שם}, עוד מעט", "", {})).toBe("עוד מעט");
  });
});
