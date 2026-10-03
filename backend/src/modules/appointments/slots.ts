import { prisma } from "@noa/db";
import { dayOffset, minutesFromClock, slotsForDay } from "@noa/shared";
import { addDays, atJerusalem, dayKey, weekdaySunday0 } from "../../lib/time.js";

type Span = { startsAt: Date; endsAt: Date };

export async function openSlots(serviceCode: string) {
  const service = await prisma.service.findUnique({ where: { code: serviceCode } });
  if (!service) return [];
  const marked = await loadMarkedWeek();
  const today = dayKey(new Date());
  const span = horizonDays(today);
  const busy = await loadBusy(today, span);
  const days = [];
  for (let offset = 0; offset < span; offset += 1) {
    const day = addDays(today, offset);
    const slots = slotsOn(day, offset, marked, busy, service.durationMin, service.bufferMin);
    if (slots.length) days.push({ day, slots });
  }
  return days;
}

export async function slotIsOpen(serviceCode: string, startsAt: Date) {
  const days = await openSlots(serviceCode);
  return days.some((day) => day.slots.some((slot) => new Date(slot).getTime() === startsAt.getTime()));
}

// Current month, the next one, and two months past that. The last day stays, so the far month is not cut in half.
function horizonDays(today: string): number {
  const [year = 0, month = 1] = today.split("-").map(Number);
  const end = new Date(Date.UTC(year, month + 3, 0)).toISOString().slice(0, 10);
  return dayOffset(end, today) + 1;
}

type StoredWeek = Partial<Record<string, { start?: string; end?: string } | null>>;

async function loadMarkedWeek(): Promise<StoredWeek> {
  const stored = await prisma.setting.findUnique({ where: { key: "markedWeek" } });
  return (stored?.value ?? {}) as StoredWeek;
}

async function loadBusy(today: string, span: number): Promise<Span[]> {
  const start = atJerusalem(today, 0);
  const end = atJerusalem(addDays(today, span), 0);
  const where = { startsAt: { lt: end }, endsAt: { gt: start } };
  const [appointments, holds] = await Promise.all([
    prisma.appointment.findMany({ where: { ...where, status: { not: "בוטל" } }, select: { startsAt: true, endsAt: true } }),
    prisma.calendarHold.findMany({ where, select: { startsAt: true, endsAt: true } }),
  ]);
  return [...appointments, ...holds];
}

function slotsOn(day: string, offset: number, marked: StoredWeek, busy: Span[], durationMin: number, bufferMin: number) {
  const noon = atJerusalem(day, 12 * 60);
  const window = marked[String(weekdaySunday0(noon))] ?? null;
  const start = atJerusalem(day, 0);
  const end = atJerusalem(day, 24 * 60);
  const ranges = busy
    .filter((row) => row.startsAt < end && row.endsAt > start)
    .map((row) => ({
      startMin: minutesFromClock(row.startsAt.toLocaleTimeString("en-GB", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit" })),
      endMin: minutesFromClock(row.endsAt.toLocaleTimeString("en-GB", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit" })),
    }));
  const nowMin = offset === 0
    ? minutesFromClock(new Date().toLocaleTimeString("en-GB", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit" })) + 180
    : 0;
  return slotsForDay({
    window: window ? { startMin: minutesFromClock(String(window.start ?? "")), endMin: minutesFromClock(String(window.end ?? "")) } : null,
    durationMin,
    bufferMin,
    stepMin: 30,
    busy: ranges,
    earliestMin: nowMin,
  }).map((minutes) => atJerusalem(day, minutes).toISOString());
}
