import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "@noa/db";
import { calculatePrice, formatPhoneDisplay, minutesFromClock, parseNtTag, slotsForDay, type MarkedWeek } from "@noa/shared";
import { currentUser, requireUser } from "../../http/session.js";
import { jsonError } from "../../http/errors.js";
import { cancelAppointment, createAppointment, markAttendance } from "./service.js";
import { addTimeline } from "../pipelines/service.js";
import { addDays, atJerusalem, clock, dayKey, hebrewDate, weekdaySunday0 } from "../../lib/time.js";

export const appointmentRoutes = new Hono();
appointmentRoutes.use("*", requireUser);

appointmentRoutes.get("/", async (c) => {
  const from = new Date(c.req.query("from") ?? new Date().toISOString());
  const to = new Date(c.req.query("to") ?? new Date(Date.now() + 31 * 86400000).toISOString());
  const items = await prisma.appointment.findMany({
    where: { startsAt: { gte: from, lte: to }, status: { not: "בוטל" } },
    include: { contact: true, service: true },
    orderBy: { startsAt: "asc" },
  });
  const reviews = await prisma.calendarReview.count({ where: { status: "open" } });
  return c.json({ reviews, items });
});

appointmentRoutes.get("/reviews", async (c) => {
  const items = await prisma.calendarReview.findMany({ where: { status: "open" }, orderBy: { createdAt: "desc" } });
  return c.json({
    items: items.map((item) => ({
      ...item,
      detectedPhone: item.detectedPhone ? formatPhoneDisplay(item.detectedPhone) : null,
    })),
  });
});

appointmentRoutes.post("/reviews/ingest", async (c) => {
  const body = z.object({ title: z.string().min(1) }).parse(await c.req.json());
  const parsed = parseNtTag(body.title);
  const review = await prisma.calendarReview.create({
    data: { googleEventId: `manual-${Date.now()}`, title: body.title, detectedPhone: parsed?.phone ?? null, status: "open" },
  });
  return c.json(review, 201);
});

appointmentRoutes.post("/reviews/:id/dismiss", async (c) => {
  await prisma.calendarReview.update({ where: { id: c.req.param("id") }, data: { status: "dismissed" } });
  return c.json({ ok: true });
});

appointmentRoutes.post("/", async (c) => {
  const body = z.object({
    contactId: z.string(),
    serviceId: z.string(),
    startsAt: z.string(),
    motherDaughter: z.boolean().optional(),
    notes: z.string().optional(),
  }).parse(await c.req.json());
  const service = await prisma.service.findUnique({ where: { id: body.serviceId } });
  if (!service) return jsonError(c, 404, "not_found", "השירות לא נמצא");
  const startsAt = new Date(body.startsAt);
  const endsAt = new Date(startsAt.getTime() + service.durationMin * 60000);
  const clash = await prisma.appointment.findFirst({
    where: { status: { not: "בוטל" }, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } },
  });
  if (clash) return jsonError(c, 422, "taken", "השעה נתפסה");
  const before = await prisma.contact.findUnique({ where: { id: body.contactId }, select: { salesStatus: true } });
  const appointment = await createAppointment({
    contactId: body.contactId,
    serviceId: body.serviceId,
    startsAt,
    endsAt,
    bookedBy: "נועה",
    motherDaughter: body.motherDaughter,
    notes: body.notes,
    actor: currentUser(c).username,
  });
  return c.json({ ...appointment, becameClient: before?.salesStatus !== "לקוחה פעילה" }, 201);
});

appointmentRoutes.patch("/:id", async (c) => {
  const body = z.object({
    startsAt: z.string().optional(),
    endsAt: z.string().optional(),
    serviceId: z.string().optional(),
    notes: z.string().optional(),
    amountPaid: z.number().int().min(0).optional(),
    paymentMethod: z.enum(["ביט", "מזומן"]).optional(),
  }).parse(await c.req.json());
  const current = await prisma.appointment.findUnique({ where: { id: c.req.param("id") } });
  if (!current) return jsonError(c, 404, "not_found", "התור לא נמצא");
  const startsAt = body.startsAt ? new Date(body.startsAt) : current.startsAt;
  const serviceChanged = Boolean(body.serviceId && body.serviceId !== current.serviceId);
  const service = serviceChanged ? await prisma.service.findUnique({ where: { id: body.serviceId } }) : null;
  if (serviceChanged && !service) return jsonError(c, 404, "not_found", "השירות לא נמצא");
  const duration = current.endsAt.getTime() - current.startsAt.getTime();
  const endsAt = body.endsAt
    ? new Date(body.endsAt)
    : service
      ? new Date(startsAt.getTime() + service.durationMin * 60000)
      : new Date(startsAt.getTime() + duration);
  if (endsAt.getTime() - startsAt.getTime() < 30 * 60000) return jsonError(c, 422, "invalid", "התור קצר מדי");
  const clash = await prisma.appointment.findFirst({
    where: { id: { not: current.id }, status: { not: "בוטל" }, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } },
  });
  if (clash) return jsonError(c, 422, "taken", "השעה נתפסה");
  const price = service ? calculatePrice(service.price, [current.discountPct, current.motherDaughter ? 10 : 0].filter((value) => value > 0), []) : null;
  await prisma.appointment.update({
    where: { id: current.id },
    data: {
      startsAt,
      endsAt,
      wasRescheduled: startsAt.getTime() !== current.startsAt.getTime() || endsAt.getTime() !== current.endsAt.getTime(),
      ...(service ? { serviceId: service.id, listPrice: service.price, discountPct: price!.discountPct, finalPrice: price!.finalPrice } : {}),
      ...(body.notes !== undefined ? { notes: body.notes.trim() || null } : {}),
      ...(body.paymentMethod ? { paymentMethod: body.paymentMethod } : {}),
      ...(body.amountPaid != null ? { amountPaid: body.amountPaid, finalPrice: body.amountPaid } : {}),
    },
  });
  await prisma.scheduledJob.updateMany({
    where: { idempotencyKey: `noshow:${current.id}`, status: "pending" },
    data: { runAt: new Date(endsAt.getTime() + 2 * 60 * 60 * 1000) },
  });
  const changes: { field: string; from: string; to: string }[] = [];
  if (startsAt.getTime() !== current.startsAt.getTime()) changes.push({ field: "שעת התור", from: slotLabel(current.startsAt), to: slotLabel(startsAt) });
  if (body.notes !== undefined && (body.notes.trim()) !== (current.notes ?? "").trim()) {
    changes.push({ field: "מה היה בתור", from: current.notes?.trim() ?? "", to: body.notes.trim() });
  }
  if (body.amountPaid != null && (body.amountPaid !== current.amountPaid || (body.paymentMethod && body.paymentMethod !== current.paymentMethod))) {
    changes.push({
      field: "תשלום",
      from: current.amountPaid == null ? "" : moneyLabel(current.amountPaid, current.paymentMethod),
      to: moneyLabel(body.amountPaid, body.paymentMethod ?? current.paymentMethod),
    });
  }
  if (changes.length) await addTimeline(current.contactId, "field_change", currentUser(c).username, { changes });
  return c.json({ ok: true, startsAt, endsAt });
});

appointmentRoutes.post("/:id/move", async (c) => {
  const body = z.object({ startsAt: z.string() }).parse(await c.req.json());
  const current = await prisma.appointment.findUnique({ where: { id: c.req.param("id") } });
  if (!current) return jsonError(c, 404, "not_found", "התור לא נמצא");
  const startsAt = new Date(body.startsAt);
  const endsAt = new Date(startsAt.getTime() + (current.endsAt.getTime() - current.startsAt.getTime()));
  const clash = await prisma.appointment.findFirst({
    where: { id: { not: current.id }, status: { not: "בוטל" }, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } },
  });
  if (clash) return jsonError(c, 422, "taken", "השעה נתפסה");
  await prisma.appointment.update({ where: { id: current.id }, data: { startsAt, endsAt, wasRescheduled: true } });
  if (startsAt.getTime() !== current.startsAt.getTime()) {
    await addTimeline(current.contactId, "field_change", currentUser(c).username, {
      changes: [{ field: "שעת התור", from: slotLabel(current.startsAt), to: slotLabel(startsAt) }],
    });
  }
  return c.json({ ok: true, startsAt, endsAt });
});

function slotLabel(date: Date) {
  return `${hebrewDate(date)} ${clock(date)}`;
}

function moneyLabel(amount: number, method: string | null) {
  return method ? `${amount}₪ ב${method}` : `${amount}₪`;
}

appointmentRoutes.post("/:id/attendance", async (c) => {
  const body = z.object({
    status: z.enum(["הגיעה", "לא הגיעה", "נקבע"]),
    paymentMethod: z.enum(["ביט", "מזומן"]).optional(),
    amountPaid: z.number().optional(),
    completionsCount: z.number().optional(),
    notes: z.string().optional(),
  }).parse(await c.req.json());
  const appointment = await markAttendance({ appointmentId: c.req.param("id"), actor: currentUser(c).username, ...body });
  return c.json(appointment);
});

appointmentRoutes.post("/:id/cancel", async (c) => {
  const appointment = await cancelAppointment(c.req.param("id"), currentUser(c).username);
  if (!appointment) return jsonError(c, 404, "not_found", "התור לא נמצא");
  return c.json({ ok: true });
});

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
    const window = marked[weekdaySunday0(noon)] ?? null;
    const start = atJerusalem(day, 0);
    const end = atJerusalem(day, 24 * 60);
    const busyRows = await prisma.appointment.findMany({
      where: { status: { not: "בוטל" }, startsAt: { lt: end }, endsAt: { gt: start } },
    });
    const busy = busyRows.map((row) => ({
      startMin: minutesFromClock(row.startsAt.toLocaleTimeString("en-GB", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit" })),
      endMin: minutesFromClock(row.endsAt.toLocaleTimeString("en-GB", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit" })),
    }));
    const nowMin = offset === 0
      ? minutesFromClock(new Date().toLocaleTimeString("en-GB", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit" })) + 180
      : 0;
    const slots = slotsForDay({
      window: window ? { startMin: minutesFromClock(String((window as { start?: string }).start ?? "")), endMin: minutesFromClock(String((window as { end?: string }).end ?? "")) } : null,
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
