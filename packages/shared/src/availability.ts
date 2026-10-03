export type BusyRange = { startMin: number; endMin: number };

export type DayWindow = { startMin: number; endMin: number };

export function slotsForDay(input: {
  window: DayWindow | null;
  durationMin: number;
  bufferMin: number;
  stepMin: number;
  busy: BusyRange[];
  earliestMin: number;
}): number[] {
  if (!input.window) return [];
  const blocked = input.busy.map((range) => ({
    startMin: range.startMin - input.bufferMin,
    endMin: range.endMin + input.bufferMin,
  }));
  const slots: number[] = [];
  for (let start = input.window.startMin; start <= input.window.endMin - input.durationMin; start += input.stepMin) {
    if (start < input.earliestMin) continue;
    const end = start + input.durationMin;
    const hits = blocked.some((range) => start < range.endMin && end > range.startMin);
    if (!hits) slots.push(start);
  }
  return slots;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function jerusalemDay(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

export function dayOffset(day: string, today = jerusalemDay(new Date().toISOString())): number {
  return Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS);
}

export type MonthRelation = "current" | "next" | "later";

export type BookingMonth = { key: string; relation: MonthRelation };

export function bookingMonths(days: string[], today = jerusalemDay(new Date().toISOString())): BookingMonth[] {
  const current = today.slice(0, 7);
  const next = shiftMonth(current, 1);
  return [...new Set(days.map((day) => day.slice(0, 7)))].sort().map((key) => ({
    key,
    relation: key === current ? "current" : key === next ? "next" : "later",
  }));
}

export function defaultBookingMonth(months: BookingMonth[]): string {
  return months.find((month) => month.relation === "next")?.key ?? months[0]?.key ?? "";
}

function shiftMonth(key: string, by: number): string {
  const [year = 0, month = 1] = key.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1 + by, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function nearestOpenSlots(open: string[], wanted: string, limit = 3): string[] {
  const target = new Date(wanted).getTime();
  const day = jerusalemDay(wanted);
  return open
    .filter((slot) => new Date(slot).getTime() !== target)
    .sort((left, right) => {
      const leftSame = jerusalemDay(left) === day ? 0 : 1;
      const rightSame = jerusalemDay(right) === day ? 0 : 1;
      if (leftSame !== rightSame) return leftSame - rightSame;
      return Math.abs(new Date(left).getTime() - target) - Math.abs(new Date(right).getTime() - target);
    })
    .slice(0, limit);
}

export function minutesFromClock(clock: string): number {
  const [hour, minute] = clock.split(":").map(Number);
  return (hour ?? 0) * 60 + (minute ?? 0);
}

/** 0 = Sunday. Noa marks which days exist; nothing is assumed. */
export type MarkedWeek = Partial<Record<number, DayWindow | null>>;
