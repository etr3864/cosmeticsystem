import { prisma } from "@noa/db";
import { minutesFromClock, slotsForDay, type MarkedWeek } from "@noa/shared";
import { addDays, atJerusalem, dayKey, weekdaySunday0 } from "../../lib/time.js";

export async function openSlots(serviceCode: string) {
  const service = await prisma.service.findUnique({ where: { code: serviceCode } });
  if (!service) return [];
  const stored = await prisma.setting.findUnique({ where: { key: "markedWeek" } });
  const marked = (stored?.value ?? {}) as MarkedWeek;
  const today = dayKey(new Date());
  const days = [];
  for (let offset = 0; offset < 10; offset += 1) {
    const day = addDays(today, offset);
    const noon = atJerusalem(day, 12 * 60);
    const window = (marked[weekdaySunday0(noon)] ?? null) as { start?: string; end?: string } | null;
    const start = atJerusalem(day, 0);
    const end = atJerusalem(day, 24 * 60);
    const busyRows = await prisma.appointment.findMany({
      where: { status: { not: "בוטל" }, startsAt: { lt: end }, endsAt: { gt: start } },
    });
    const heldRows = await prisma.calendarHold.findMany({
      where: { startsAt: { lt: end }, endsAt: { gt: start } },
    });
    const busy = [...busyRows, ...heldRows].map((row) => ({
      startMin: minutesFromClock(row.startsAt.toLocaleTimeString("en-GB", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit" })),
      endMin: minutesFromClock(row.endsAt.toLocaleTimeString("en-GB", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit" })),
    }));
    const nowMin = offset === 0
      ? minutesFromClock(new Date().toLocaleTimeString("en-GB", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit" })) + 180
      : 0;
    const slots = slotsForDay({
      window: window ? { startMin: minutesFromClock(String(window.start ?? "")), endMin: minutesFromClock(String(window.end ?? "")) } : null,
      durationMin: service.durationMin,
      bufferMin: service.bufferMin,
      stepMin: 30,
      busy,
      earliestMin: nowMin,
    }).map((minutes) => atJerusalem(day, minutes).toISOString());
    days.push({ day, slots });
  }
  return days;
}

export async function slotIsOpen(serviceCode: string, startsAt: Date) {
  const days = await openSlots(serviceCode);
  return days.some((day) => day.slots.some((slot) => new Date(slot).getTime() === startsAt.getTime()));
}
