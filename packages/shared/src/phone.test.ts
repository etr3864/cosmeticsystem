import { describe, expect, it } from "vitest";
import {
  formatPhoneDisplay,
  normalizePhone,
  PhoneInvalidError,
  toConversationPhone,
  toOptivePhone,
} from "./phone.js";

describe("phone", () => {
  it("normalizes local, international, and whatsapp jid", () => {
    expect(normalizePhone("052-123-4567")).toBe("+972521234567");
    expect(normalizePhone("+972521234567")).toBe("+972521234567");
    expect(normalizePhone("972521234567@s.whatsapp.net")).toBe("+972521234567");
  });

  it("formats display, api, and conversation forms", () => {
    const e164 = normalizePhone("055-568-0095");
    expect(formatPhoneDisplay(e164)).toBe("055-568-0095");
    expect(toOptivePhone(e164)).toBe("972555680095");
    expect(toConversationPhone(e164)).toBe("9720555680095");
  });

  it("rejects an invalid number", () => {
    expect(() => normalizePhone("123")).toThrow(PhoneInvalidError);
  });
});
