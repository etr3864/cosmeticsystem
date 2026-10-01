import { normalizePhone } from "./phone.js";

export type ParsedNtTag = {
  phone: string;
  serviceCode: string | null;
  bookedByAi: boolean;
};

const TAG = /\[NT:\s*([0-9+\-\s]+)\s*(?::\s*([A-Za-z0-9_-]+))?\s*\]/i;

export function parseNtTag(description: string): ParsedNtTag | null {
  const match = description.match(TAG);
  if (!match?.[1]) return null;
  try {
    return {
      phone: normalizePhone(match[1]),
      serviceCode: match[2]?.toUpperCase() ?? null,
      bookedByAi: /מקור:\s*שירה/.test(description),
    };
  } catch {
    return null;
  }
}

export function looksLikeNtAttempt(description: string): boolean {
  return /\[?\s*NT\b/i.test(description) || /(?:\+972|972|0\d{8,9})/.test(description);
}

export function buildNtDescription(phone: string, serviceCode: string, fromShira: boolean): string {
  const lines = [`[NT:${phone}:${serviceCode}]`];
  if (fromShira) lines.push("מקור: שירה");
  return lines.join("\n");
}
