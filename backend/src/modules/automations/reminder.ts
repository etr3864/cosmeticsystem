import { prisma } from "@noa/db";
import { TIMEZONE } from "@noa/shared";
import { formatInTimeZone } from "date-fns-tz";
import { lastSendAtOrBefore, loadSendWindow } from "../../lib/send-window.js";
import { addDays, clock, dayKey, hebrewDate, weekdaySunday0 } from "../../lib/time.js";
import { enqueueAutomation, pushFacts } from "./service.js";

const KEY = "reminder";
const WEEKDAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

export type ReminderPayload = { appointmentId?: string; startsAt?: string; day?: string };

// The key carries the start time, so a moved appointment gets a fresh job while moving it
// back to a time that was already reminded finds the sent job and stays quiet.
function jobKey(appointmentId: string, startsAt: Date) {
  return `reminder:${appointmentId}:${startsAt.getTime()}`;
}

async function cancelPending(appointmentId: string, keep?: string) {
  await prisma.scheduledJob.updateMany({
    where: {
      status: "pending",
      idempotencyKey: { startsWith: `reminder:${appointmentId}:`, ...(keep ? { not: keep } : {}) },
    },
    data: { status: "cancelled" },
  });
}

/**
 * Brings the reminder for one appointment in line with its current state: schedules it, moves it,
 * or cancels it. Shira reminds her own bookings, so appointments booked by AI are left to her.
 */
export async function syncReminder(appointmentId: string) {
  const appointment = await prisma.appointment.findUnique({ where: { id: appointmentId } });
  if (!appointment || appointment.status !== "נקבע" || appointment.bookedBy === "AI") {
    await cancelPending(appointmentId);
    return;
  }
  const automation = await prisma.automation.findUnique({ where: { key: KEY } });
  const leadMinutes = Math.abs(automation?.delayMinutes ?? 0);
  const ideal = new Date(appointment.startsAt.getTime() - leadMinutes * 60_000);
  const sendAt = lastSendAtOrBefore(ideal, await loadSendWindow());
  const key = jobKey(appointment.id, appointment.startsAt);
  if (!automation?.active || !sendAt || sendAt.getTime() <= Date.now()) {
    await cancelPending(appointmentId);
    return;
  }
  await cancelPending(appointmentId, key);
  const existing = await prisma.scheduledJob.findUnique({ where: { idempotencyKey: key } });
  if (existing?.status === "sent" || existing?.status === "running") return;
  if (existing) {
    await prisma.scheduledJob.update({ where: { id: existing.id }, data: { status: "pending", runAt: sendAt, attempts: 0, lastError: null } });
    return;
  }
  await enqueueAutomation({
    key: KEY,
    contactId: appointment.contactId,
    runAt: sendAt,
    idempotencyKey: key,
    payload: { appointmentId: appointment.id, startsAt: appointment.startsAt.toISOString(), day: dayKey(appointment.startsAt) },
  });
}

/** A changed lead time moves the reminders that are still waiting, not only those booked from now on. */
export async function resyncPendingReminders() {
  const waiting = await prisma.scheduledJob.findMany({
    where: { status: "pending", automation: { key: KEY } },
    select: { payload: true },
  });
  const ids = new Set(waiting.map((job) => (job.payload as ReminderPayload).appointmentId).filter((id): id is string => Boolean(id)));
  for (const id of ids) await syncReminder(id);
}

/** "היום בשעה 14:00", "מחר, יום שלישי 11.11, בשעה 14:00" or "ביום ראשון 16.11 בשעה 10:00", relative to the moment of sending. */
export function whenText(startsAt: Date, now: Date) {
  const day = dayKey(startsAt);
  const weekday = WEEKDAYS[weekdaySunday0(startsAt)];
  const date = formatInTimeZone(startsAt, TIMEZONE, "d.M");
  if (day === dayKey(now)) return `היום בשעה ${clock(startsAt)}`;
  if (day === addDays(dayKey(now), 1)) return `מחר, יום ${weekday} ${date}, בשעה ${clock(startsAt)}`;
  return `ביום ${weekday} ${date} בשעה ${clock(startsAt)}`;
}

/** Re-checks the appointment at send time, so a cancelled, moved or already-reminded day sends nothing. */
export async function prepareReminder(contactId: string, payload: ReminderPayload, template: string) {
  if (!payload.appointmentId) return { skip: true };
  const appointment = await prisma.appointment.findUnique({ where: { id: payload.appointmentId }, include: { service: true } });
  const now = new Date();
  if (
    !appointment
    || appointment.status !== "נקבע"
    || appointment.bookedBy === "AI"
    || appointment.startsAt.toISOString() !== payload.startsAt
    || appointment.startsAt.getTime() <= now.getTime()
  ) {
    return { skip: true };
  }
  const sameDay = await prisma.scheduledJob.findFirst({
    where: { contactId, status: "sent", automation: { key: KEY }, payload: { path: ["day"], equals: dayKey(appointment.startsAt) } },
  });
  if (sameDay) return { skip: true };
  const when = whenText(appointment.startsAt, now);
  return {
    template,
    vars: { מתי: when, שירות: appointment.service.name },
    facts: pushFacts(
      `נשלחה ללקוחה תזכורת לתור ${appointment.service.name}, ${when}.`,
      { שירות: appointment.service.name, "מתי התור": `${hebrewDate(appointment.startsAt)} בשעה ${clock(appointment.startsAt)}` },
    ),
  };
}
