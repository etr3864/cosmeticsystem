import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "@noa/db";
import { formatPhoneDisplay, isSalesStatus, normalizePhone, toOptivePhone } from "@noa/shared";
import { sha256 } from "../../lib/crypto.js";
import { jsonError } from "../../http/errors.js";
import { addTimeline, setSalesStatus } from "../pipelines/service.js";
import { calculatePrice } from "@noa/shared";

export const externalRoutes = new Hono();

externalRoutes.use("*", async (c, next) => {
  const header = c.req.header("authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "");
  if (!token) return jsonError(c, 401, "unauthorized", "חסר מפתח");
  const row = await prisma.apiToken.findUnique({ where: { tokenHash: sha256(token) } });
  if (!row?.active) return jsonError(c, 401, "unauthorized", "המפתח לא פעיל");
  await prisma.apiToken.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } });
  await next();
});

externalRoutes.get("/contacts/:phone", async (c) => {
  const phone = normalizePhone(c.req.param("phone"));
  const contact = await prisma.contact.findUnique({
    where: { phone },
    include: { services: { include: { service: true } }, appointments: { where: { startsAt: { gt: new Date() }, status: "נקבע" }, take: 3 }, credits: true },
  });
  if (!contact) return jsonError(c, 404, "not_found", "לא נמצאה");
  return c.json({ ...contact, phoneOptive: toOptivePhone(contact.phone), phoneDisplay: formatPhoneDisplay(contact.phone) });
});

externalRoutes.post("/contacts/:phone", async (c) => {
  const phone = normalizePhone(c.req.param("phone"));
  const body = z.object({
    name: z.string().optional(),
    source: z.string().optional(),
    salesStatus: z.string().optional(),
    summary: z.string().optional(),
    note: z.string().optional(),
    notRelevantReason: z.string().optional(),
  }).parse(await c.req.json());
  const contact = await prisma.contact.upsert({
    where: { phone },
    update: { name: body.name, source: body.source, lastAiSummary: body.summary },
    create: { phone, name: body.name ?? "בלי שם", source: body.source ?? "פנייה ישירה לנועה", salesStatus: "ליד חדש" },
  });
  if (body.salesStatus && isSalesStatus(body.salesStatus)) await setSalesStatus(contact.id, body.salesStatus, "ai", body.notRelevantReason);
  if (body.summary) await addTimeline(contact.id, "ai_summary", "ai", { text: body.summary });
  if (body.note) await addTimeline(contact.id, "note", "ai", { text: body.note });
  return c.json({ id: contact.id, phone: toOptivePhone(phone) });
});

externalRoutes.get("/contacts/:phone/price", async (c) => {
  const phone = normalizePhone(c.req.param("phone"));
  const service = await prisma.service.findFirst({ where: { code: c.req.query("service") ?? "NAILS" } });
  if (!service) return jsonError(c, 404, "not_found", "השירות לא נמצא");
  const contact = await prisma.contact.findUnique({ where: { phone }, include: { credits: true } });
  const credits = contact?.credits.filter((item) => item.expiresAt > new Date()).map((item) => item.remainingPct) ?? [];
  return c.json(calculatePrice(service.price, [], credits));
});
