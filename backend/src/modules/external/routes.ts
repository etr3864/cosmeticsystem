import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "@noa/db";
import { calculatePrice, isSalesStatus, normalizePhone } from "@noa/shared";
import { sha256 } from "../../lib/crypto.js";
import { jsonError } from "../../http/errors.js";
import { addTimeline, setSalesStatus } from "../pipelines/service.js";
import { loadContact, presentContact } from "./present.js";

const postBody = z.object({
  name: z.string().optional(),
  source: z.string().optional(),
  salesStatus: z.string().optional(),
  summary: z.string().optional(),
  note: z.string().optional(),
  notRelevantReason: z.string().optional(),
}).strict();

export const externalRoutes = new Hono();

externalRoutes.use("*", async (c, next) => {
  const header = c.req.header("authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) return jsonError(c, 401, "unauthorized", "חסר מפתח");
  const row = await prisma.apiToken.findUnique({ where: { tokenHash: sha256(token) } });
  if (!row?.active) return jsonError(c, 401, "unauthorized", "המפתח לא פעיל");
  await prisma.apiToken.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } });
  await next();
});

externalRoutes.get("/contacts/:phone", async (c) => {
  const phone = normalizePhone(c.req.param("phone"));
  const contact = await loadContact(phone);
  if (!contact) return jsonError(c, 404, "not_found", "לא נמצאה");
  return c.json(presentContact(contact));
});

externalRoutes.post("/contacts/:phone", async (c) => {
  const phone = normalizePhone(c.req.param("phone"));
  const body = postBody.parse(await c.req.json());
  const salesStatus = body.salesStatus && isSalesStatus(body.salesStatus) ? body.salesStatus : undefined;
  if (body.salesStatus && !salesStatus) return jsonError(c, 422, "invalid", "סטטוס לא מוכר", "salesStatus");
  if (salesStatus === "לא רלוונטית" && !body.notRelevantReason?.trim()) {
    return jsonError(c, 422, "missing", "חסרה סיבה", "notRelevantReason");
  }
  const contact = await prisma.contact.upsert({
    where: { phone },
    update: {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.source !== undefined ? { source: body.source } : {}),
      ...(body.summary !== undefined ? { lastAiSummary: body.summary } : {}),
    },
    create: {
      phone,
      name: body.name?.trim() || "בלי שם",
      source: body.source?.trim() || "פנייה ישירה לנועה",
      salesStatus: "ליד חדש",
      ...(body.summary !== undefined ? { lastAiSummary: body.summary } : {}),
    },
  });
  let messageQueued = false;
  if (salesStatus) {
    const saved = await setSalesStatus(contact.id, salesStatus, "ai", body.notRelevantReason);
    messageQueued = saved.messageQueued;
  }
  if (body.summary) await addTimeline(contact.id, "ai_summary", "ai", { text: body.summary });
  if (body.note) await addTimeline(contact.id, "note", "ai", { text: body.note });
  const fresh = await loadContact(phone);
  if (!fresh) return jsonError(c, 404, "not_found", "לא נמצאה");
  return c.json({ ...presentContact(fresh), messageQueued });
});

externalRoutes.get("/contacts/:phone/price", async (c) => {
  const phone = normalizePhone(c.req.param("phone"));
  const code = c.req.query("service") ?? "NAILS";
  const service = await prisma.service.findFirst({ where: { code } });
  if (!service) return jsonError(c, 404, "not_found", "השירות לא נמצא", "service");
  const contact = await prisma.contact.findUnique({
    where: { phone },
    include: { credits: { where: { expiresAt: { gt: new Date() }, remainingPct: { gt: 0 } } } },
  });
  const credits = contact?.credits.map((item) => item.remainingPct) ?? [];
  return c.json({
    service: service.code,
    name: service.name,
    listPrice: service.price,
    contactFound: Boolean(contact),
    ...calculatePrice(service.price, [], credits),
  });
});
