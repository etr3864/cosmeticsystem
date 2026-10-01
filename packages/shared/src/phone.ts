import { parsePhoneNumberFromString, type PhoneNumber } from "libphonenumber-js";

export class PhoneInvalidError extends Error {
  constructor() {
    super("מספר הטלפון לא תקין");
    this.name = "PhoneInvalidError";
  }
}

function stripChannelNoise(input: string): string {
  return input.replace(/@s\.whatsapp\.net$/i, "").trim();
}

export function parseIsraeliPhone(input: string): PhoneNumber {
  const raw = stripChannelNoise(input);
  const phone = parsePhoneNumberFromString(raw, "IL");
  if (!phone?.isValid()) throw new PhoneInvalidError();
  return phone;
}

/** E.164, for example +972521234567 */
export function normalizePhone(input: string): string {
  return parseIsraeliPhone(input).number;
}

/** 052-123-4567 */
export function formatPhoneDisplay(e164: string): string {
  const phone = parseIsraeliPhone(e164);
  const national = phone.formatNational().replace(/\D/g, "");
  if (national.length === 10) {
    return `${national.slice(0, 3)}-${national.slice(3, 6)}-${national.slice(6)}`;
  }
  return phone.formatNational();
}

/** Digits for the Optive API, without a leading trunk zero. */
export function toOptivePhone(e164: string): string {
  return parseIsraeliPhone(e164).number.replace(/^\+/, "");
}

/**
 * Conversation id as Optive shows it: 972 plus the national number,
 * including the leading 0. 055-568-0095 becomes 9720555680095.
 */
export function toConversationPhone(e164: string): string {
  const national = parseIsraeliPhone(e164).formatNational().replace(/\D/g, "");
  return `972${national}`;
}

export function phonesMatch(a: string, b: string): boolean {
  try {
    return normalizePhone(a) === normalizePhone(b);
  } catch {
    return false;
  }
}
