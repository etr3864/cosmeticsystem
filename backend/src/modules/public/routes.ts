import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "@noa/db";
import { CLINIC_ADDRESS, CLINIC_PARKING, CLINIC_UNIT, DISCOUNT_PERCENT, priceAfterPercent } from "@noa/shared";
import { findLink } from "../links/service.js";
import { createAppointment } from "../appointments/service.js";
import { mirrorAppointment } from "../calendar/google.js";
import { openSlots, slotIsOpen } from "../appointments/slots.js";
import { jsonError } from "../../http/errors.js";
import { normalizePhone } from "@noa/shared";

export const publicRoutes = new Hono();

publicRoutes.get("/:token", async (c) => {
  const link = await findLink(c.req.param("token"));
  if (!link) return jsonError(c, 404, "not_found", "הקישור לא פעיל");
  if (link.kind === "discount_booking" && link.usedAt) return c.json({ expired: true, message: "ההטבה כבר נוצלה" });
  if (link.expired) return c.json({ expired: true, message: "ההטבה הסתיימה" });
  const clinic = await prisma.setting.findUnique({ where: { key: "clinic" } });
  const service = await prisma.service.findFirst({ where: { code: "NAILS", active: true } });
  const questionnaire = service ? await prisma.questionnaire.findUnique({ where: { serviceId: service.id } }) : null;
  return c.json({
    kind: link.kind,
    name: link.contact.name,
    expired: false,
    clinic: clinic?.value ?? { address: CLINIC_ADDRESS, unit: CLINIC_UNIT, parking: CLINIC_PARKING },
    price: service?.price ?? 120,
    serviceId: service?.id ?? null,
    discounted: priceAfterPercent(service?.price ?? 120, DISCOUNT_PERCENT),
    expiresAt: link.expiresAt,
    questions: questionnaire?.questions ?? [],
    title: questionnaire?.title ?? "בשבילך",
  });
});

publicRoutes.get("/:token/slots", async (c) => {
  const link = await findLink(c.req.param("token"));
  if (!link || link.expired || link.usedAt) return jsonError(c, 404, "not_found", "ההטבה הסתיימה");
  return c.json({ days: await openSlots("NAILS") });
});

publicRoutes.post("/:token/join", async (c) => {
  const link = await findLink(c.req.param("token"));
  if (!link || link.kind !== "referral") return jsonError(c, 404, "not_found", "הקישור לא פעיל");
  const body = z.object({ name: z.string().min(1), phone: z.string().min(1) }).parse(await c.req.json());
  const phone = normalizePhone(body.phone);
  const existing = await prisma.contact.findUnique({ where: { phone } });
  if (existing) return jsonError(c, 422, "taken", "המספר כבר שמור אצל נועה");
  const contact = await prisma.contact.create({
    data: { phone, name: body.name, source: "המלצה מלקוחה", referredById: link.contactId, salesStatus: "ליד חדש" },
  });
  await rememberReferral(link.contactId, contact.id);
  return c.json({ ok: true, contactId: contact.id });
});

publicRoutes.post("/:token/book-friend", async (c) => {
  const link = await findLink(c.req.param("token"));
  if (!link || link.kind !== "referral") return jsonError(c, 404, "not_found", "הקישור לא פעיל");
  const body = z.object({ name: z.string().min(1), phone: z.string().min(1), startsAt: z.string() }).parse(await c.req.json());
  const phone = normalizePhone(body.phone);
  const startsAt = new Date(body.startsAt);
  if (Number.isNaN(startsAt.getTime())) return jsonError(c, 400, "invalid", "השעה לא תקינה");
  if (!(await slotIsOpen("NAILS", startsAt))) return jsonError(c, 422, "taken", "השעה נתפסה");
  const existing = await prisma.contact.findUnique({ where: { phone } });
  if (existing) return jsonError(c, 422, "taken", "המספר כבר שמור אצל נועה");
  const contact = await prisma.contact.create({
    data: { phone, name: body.name, source: "המלצה מלקוחה", referredById: link.contactId, salesStatus: "נקבע תור אנושי" },
  });
  await rememberReferral(link.contactId, contact.id);
  const service = await prisma.service.findFirstOrThrow({ where: { code: "NAILS" } });
  const endsAt = new Date(startsAt.getTime() + service.durationMin * 60000);
  const appointment = await createAppointment({
    contactId: contact.id,
    serviceId: service.id,
    startsAt,
    endsAt,
    bookedBy: "המלצה",
    discountPct: DISCOUNT_PERCENT,
  });
  await mirrorAppointment(appointment.id);
  return c.json({ ok: true, startsAt: appointment.startsAt });
});

publicRoutes.post("/:token/book", async (c) => {
  const link = await findLink(c.req.param("token"));
  if (!link || link.expired || link.kind !== "discount_booking") return jsonError(c, 404, "not_found", "ההטבה הסתיימה");
  if (link.usedAt) return jsonError(c, 404, "not_found", "ההטבה כבר נוצלה");
  const body = z.object({ startsAt: z.string() }).parse(await c.req.json());
  const service = await prisma.service.findFirstOrThrow({ where: { code: "NAILS" } });
  const startsAt = new Date(body.startsAt);
  if (Number.isNaN(startsAt.getTime())) return jsonError(c, 400, "invalid", "השעה לא תקינה");
  if (!(await slotIsOpen("NAILS", startsAt))) return jsonError(c, 422, "taken", "השעה נתפסה");
  const endsAt = new Date(startsAt.getTime() + service.durationMin * 60000);
  const appointment = await createAppointment({
    contactId: link.contactId,
    serviceId: service.id,
    startsAt,
    endsAt,
    bookedBy: "קישור מוזל",
    discountPct: DISCOUNT_PERCENT,
  });
  await mirrorAppointment(appointment.id);
  await prisma.publicLink.update({ where: { id: link.id }, data: { usedAt: new Date() } });
  const clinic = await prisma.setting.findUnique({ where: { key: "clinic" } });
  return c.json({ ok: true, startsAt: appointment.startsAt, clinic: clinic?.value });
});

publicRoutes.post("/:token/for-you", async (c) => {
  const link = await findLink(c.req.param("token"));
  if (!link || link.kind !== "questionnaire") return jsonError(c, 404, "not_found", "הקישור לא פעיל");
  const body = z.object({ serviceId: z.string(), answers: z.record(z.string()) }).parse(await c.req.json());
  await prisma.questionnaireResponse.upsert({
    where: { contactId_serviceId: { contactId: link.contactId, serviceId: body.serviceId } },
    update: { answers: body.answers, submittedAt: new Date() },
    create: { contactId: link.contactId, serviceId: body.serviceId, answers: body.answers },
  });
  return c.json({ ok: true });
});

async function rememberReferral(referrerId: string, referredId: string) {
  const prior = await prisma.referral.findFirst({ where: { referrerId, referredId } });
  if (!prior) await prisma.referral.create({ data: { referrerId, referredId, via: "link" } });
}
