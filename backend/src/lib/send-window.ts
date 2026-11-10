import { prisma } from "@noa/db";
import { addDays, atJerusalem, dayKey, weekdaySunday0 } from "./time.js";

export type SendWindow = { days: number[]; start: string; end: string };

const DEFAULT_WINDOW: SendWindow = { days: [0, 1, 2, 3, 4], start: "08:00", end: "20:00" };

function minutesOf(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

/** The window lives in Setting so it can change without a deploy; a missing or broken value falls back to Sun–Thu 08:00–20:00. */
export async function loadSendWindow(): Promise<SendWindow> {
  const row = await prisma.setting.findUnique({ where: { key: "sendWindow" } });
  const value = row?.value as Partial<SendWindow> | null | undefined;
  const valid = Array.isArray(value?.days) && value.days.length > 0
    && typeof value?.start === "string" && typeof value?.end === "string"
    && minutesOf(value.start) < minutesOf(value.end);
  return valid ? (value as SendWindow) : DEFAULT_WINDOW;
}

function openDay(day: string, window: SendWindow) {
  return window.days.includes(weekdaySunday0(atJerusalem(day, 12 * 60)));
}

/** The first moment at or after `from` that falls inside the window. */
export function nextSendAt(from: Date, window: SendWindow = DEFAULT_WINDOW): Date {
  for (let offset = 0; offset < 8; offset += 1) {
    const day = addDays(dayKey(from), offset);
    if (!openDay(day, window)) continue;
    const open = atJerusalem(day, minutesOf(window.start));
    const close = atJerusalem(day, minutesOf(window.end));
    if (from < open) return open;
    if (from.getTime() <= close.getTime()) return from;
  }
  return atJerusalem(addDays(dayKey(from), 2), minutesOf(window.start));
}

/**
 * The last moment at or before `at` that falls inside the window, or null if none in the week before.
 * Stops `marginMin` short of closing so a job picked up a few seconds late is still inside the window.
 */
export function lastSendAtOrBefore(at: Date, window: SendWindow = DEFAULT_WINDOW, marginMin = 10): Date | null {
  for (let offset = 0; offset < 8; offset += 1) {
    const day = addDays(dayKey(at), -offset);
    if (!openDay(day, window)) continue;
    const open = atJerusalem(day, minutesOf(window.start));
    const close = atJerusalem(day, minutesOf(window.end) - marginMin);
    if (at < open) continue;
    return at.getTime() <= close.getTime() ? at : close;
  }
  return null;
}
