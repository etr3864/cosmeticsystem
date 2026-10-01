import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "@noa/db";
import { calculatePrice, formatPhoneDisplay, parseNtTag } from "@noa/shared";
import { currentUser, requireUser } from "../../http/session.js";
import { jsonError } from "../../http/errors.js";
import { cancelAppointment, createAppointment, markAttendance, placeAppointment } from "./service.js";
import { mirrorAppointment } from "../calendar/google.js";
import { addTimeline } from "../pipelines/service.js";
import { clock, hebrewDate } from "../../lib/time.js";

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
  if (Number.isNaN(startsAt.getTime())) return jsonError(c, 400, "invalid", "השעה לא תקינה");
  const endsAt = new Date(startsAt.getTime() + service.durationMin * 60000);
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
  await mirrorAppointment(appointment.id);
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
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) return jsonError(c, 400, "invalid", "השעה לא תקינה");
  if (endsAt.getTime() - startsAt.getTime() < 30 * 60000) return jsonError(c, 422, "invalid", "התור קצר מדי");
  const price = service ? calculatePrice(service.price, [current.discountPct, current.motherDaughter ? 10 : 0].filter((value) => value > 0), []) : null;
  await placeAppointment(current.id, startsAt, endsAt, {
    wasRescheduled: startsAt.getTime() !== current.startsAt.getTime() || endsAt.getTime() !== current.endsAt.getTime(),
    ...(service ? { service: { connect: { id: service.id } }, listPrice: service.price, discountPct: Math.round(price!.discountPct), finalPrice: Math.round(price!.finalPrice) } : {}),
    ...(body.notes !== undefined ? { notes: body.notes.trim() || null } : {}),
    ...(body.paymentMethod ? { paymentMethod: body.paymentMethod } : {}),
    ...(body.amountPaid != null ? { amountPaid: body.amountPaid, finalPrice: body.amountPaid } : {}),
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
  await mirrorAppointment(current.id);
  return c.json({ ok: true, startsAt, endsAt });
});

appointmentRoutes.post("/:id/move", async (c) => {
  const body = z.object({ startsAt: z.string() }).parse(await c.req.json());
  const current = await prisma.appointment.findUnique({ where: { id: c.req.param("id") } });
  if (!current) return jsonError(c, 404, "not_found", "התור לא נמצא");
  const startsAt = new Date(body.startsAt);
  if (Number.isNaN(startsAt.getTime())) return jsonError(c, 400, "invalid", "השעה לא תקינה");
  const endsAt = new Date(startsAt.getTime() + (current.endsAt.getTime() - current.startsAt.getTime()));
  await placeAppointment(current.id, startsAt, endsAt, { wasRescheduled: true });
  await prisma.scheduledJob.updateMany({
    where: { idempotencyKey: `noshow:${current.id}`, status: "pending" },
    data: { runAt: new Date(endsAt.getTime() + 2 * 60 * 60 * 1000) },
  });
  if (startsAt.getTime() !== current.startsAt.getTime()) {
    await addTimeline(current.contactId, "field_change", currentUser(c).username, {
      changes: [{ field: "שעת התור", from: slotLabel(current.startsAt), to: slotLabel(startsAt) }],
    });
  }
  await mirrorAppointment(current.id);
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
  await mirrorAppointment(appointment.id);
  return c.json({ ok: true });
});

