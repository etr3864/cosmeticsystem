import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { TIMEZONE } from "@noa/shared";

export function dayKey(date: Date): string {
  return formatInTimeZone(date, TIMEZONE, "yyyy-MM-dd");
}

export function weekdaySunday0(date: Date): number {
  const iso = Number(formatInTimeZone(date, TIMEZONE, "i"));
  return iso === 7 ? 0 : iso;
}

export function clock(date: Date): string {
  return formatInTimeZone(date, TIMEZONE, "HH:mm");
}

export function hebrewDate(date: Date): string {
  return new Intl.DateTimeFormat("he-IL", { timeZone: TIMEZONE, day: "numeric", month: "numeric", year: "numeric" }).format(date);
}

export function atJerusalem(day: string, minutes: number): Date {
  const hours = String(Math.floor(minutes / 60)).padStart(2, "0");
  const mins = String(minutes % 60).padStart(2, "0");
  return fromZonedTime(`${day} ${hours}:${mins}:00`, TIMEZONE);
}

export function addDays(day: string, amount: number): string {
  const date = fromZonedTime(`${day} 12:00:00`, TIMEZONE);
  date.setUTCDate(date.getUTCDate() + amount);
  return dayKey(date);
}
