import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "@noa/db";
import { calculatePrice, canSeeTechnical, canWriteBusiness } from "@noa/shared";
import { requireUser, currentUser } from "../../http/session.js";
import { jsonError } from "../../http/errors.js";
import { decrypt, encrypt, randomToken, sha256 } from "../../lib/crypto.js";
import { googleAccountEmail, mirrorAppointment, resetGoogleSync, testGoogle } from "../calendar/google.js";
import { rememberAppointment } from "../appointments/service.js";

export const settingsRoutes = new Hono();
settingsRoutes.use("*", requireUser);

settingsRoutes.get("/", async (c) => {
  const technical = canSeeTechnical(currentUser(c).role);
  const [settings, services, automations, campaigns, secret] = await Promise.all([
    prisma.setting.findMany(),
    prisma.service.findMany({ orderBy: { name: "asc" } }),
    prisma.automation.findMany({ orderBy: { key: "asc" } }),
    prisma.campaign.findMany({ include: { spend: true } }),
    prisma.secret.findUnique({ where: { key: "optive_api_key" } }),
  ]);
  return c.json({
    settings: Object.fromEntries(settings.map((item) => [item.key, item.value])),
    services,
    automations,
    campaigns,
    technical,
    optiveHint: secret ? decrypt(secret.ciphertext).slice(-4) : null,
    googleHint: await googleAccountEmail(),
    apiBase: `${(process.env.FRONTEND_URL ?? "http://localhost:3000").replace(/\/$/, "")}/backend`,
  });
});

settingsRoutes.put("/hours", async (c) => {
  const body = z.object({ markedWeek: z.record(z.object({ start: z.string(), end: z.string() }).nullable()) }).parse(await c.req.json());
  await prisma.setting.upsert({ where: { key: "markedWeek" }, update: { value: body.markedWeek }, create: { key: "markedWeek", value: body.markedWeek } });
  return c.json({ ok: true });
});

settingsRoutes.put("/automations/:key", async (c) => {
  const body = z.object({ messageTemplate: z.string().optional(), active: z.boolean().optional(), delayMinutes: z.number().optional() }).parse(await c.req.json());
  await prisma.automation.update({ where: { key: c.req.param("key") }, data: body });
  return c.json({ ok: true });
});

settingsRoutes.put("/services/:id", async (c) => {
  const body = z.object({ price: z.number().int().min(0).optional(), durationMin: z.number().int().min(30).optional(), active: z.boolean().optional() }).parse(await c.req.json());
  const service = await prisma.service.update({ where: { id: c.req.param("id") }, data: body });
  if (body.price != null) {
    const open = await prisma.appointment.findMany({ where: { serviceId: service.id, amountPaid: null, status: { not: "בוטל" } } });
    for (const row of open) {
      const next = calculatePrice(body.price, row.discountPct > 0 ? [row.discountPct] : [], []);
      await prisma.appointment.update({
        where: { id: row.id },
        data: { listPrice: body.price, discountPct: next.discountPct, finalPrice: Math.round(next.finalPrice) },
      });
    }
  }
  if (body.durationMin != null) {
    const rows = await prisma.appointment.findMany({ where: { serviceId: service.id, status: { not: "בוטל" } } });
    const moved: string[] = [];
    for (const row of rows) {
      const endsAt = new Date(row.startsAt.getTime() + body.durationMin * 60000);
      if (endsAt.getTime() === row.endsAt.getTime()) continue;
      await prisma.appointment.update({ where: { id: row.id }, data: { endsAt } });
      await prisma.scheduledJob.updateMany({
        where: { idempotencyKey: `noshow:${row.id}`, status: "pending" },
        data: { runAt: new Date(endsAt.getTime() + 2 * 60 * 60 * 1000) },
      });
      moved.push(row.id);
    }
    for (const id of moved) {
      await rememberAppointment(id, "זז");
      await mirrorAppointment(id);
    }
  }
  return c.json({ ok: true, price: service.price, durationMin: service.durationMin });
});

settingsRoutes.post("/campaigns", async (c) => {
  const body = z.object({ name: z.string().min(1), prefillText: z.string().optional() }).parse(await c.req.json());
  const campaign = await prisma.campaign.create({ data: { name: body.name, prefillText: body.prefillText ?? "" } });
  return c.json(campaign, 201);
});

settingsRoutes.put("/budget", async (c) => {
  const body = z.object({
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    amount: z.number().int().min(0),
  }).parse(await c.req.json());
  const existing = await prisma.campaignSpend.findMany({ where: { month: body.month }, orderBy: { createdAt: "asc" } });
  if (existing.length === 0) {
    const campaign = await prisma.campaign.findFirst({ where: { name: "שיווק" } })
      ?? await prisma.campaign.create({ data: { name: "שיווק" } });
    await prisma.campaignSpend.create({ data: { campaignId: campaign.id, month: body.month, amount: body.amount } });
  } else {
    const current = existing[0];
    if (!current) return jsonError(c, 404, "not_found", "התקציב לא נמצא");
    await prisma.campaignSpend.update({ where: { id: current.id }, data: { amount: body.amount } });
    if (existing.length > 1) await prisma.campaignSpend.deleteMany({ where: { id: { in: existing.slice(1).map((row) => row.id) } } });
  }
  const campaigns = await prisma.campaign.findMany({ include: { spend: true }, orderBy: { name: "asc" } });
  return c.json({ campaigns });
});

settingsRoutes.post("/campaigns/:id/spend", async (c) => {
  const body = z.object({ month: z.string(), amount: z.number() }).parse(await c.req.json());
  const spend = await prisma.campaignSpend.upsert({
    where: { campaignId_month: { campaignId: c.req.param("id"), month: body.month } },
    update: { amount: body.amount },
    create: { campaignId: c.req.param("id"), month: body.month, amount: body.amount },
  });
  return c.json(spend);
});

settingsRoutes.post("/optive/test", async (c) => {
  if (!canWriteBusiness(currentUser(c).role)) return jsonError(c, 401, "forbidden", "אין הרשאה");
  const secret = await prisma.secret.findUnique({ where: { key: "optive_api_key" } });
  if (!secret) return jsonError(c, 422, "missing", "עוד אין מפתח");
  const response = await fetch("https://api.0ptive.com/api/external/triggers/push", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": decrypt(secret.ciphertext) },
    body: "{}",
  });
  if (response.status === 401 || response.status === 403) return jsonError(c, 422, "invalid", "המפתח לא התקבל");
  return c.json({ ok: true });
});

settingsRoutes.put("/google", async (c) => {
  if (!canWriteBusiness(currentUser(c).role)) return jsonError(c, 401, "forbidden", "אין הרשאה");
  const body = z.object({
    calendarId: z.string().trim().min(3).max(200),
    key: z.string().optional(),
  }).parse(await c.req.json());
  let email: string | null = null;
  if (body.key?.trim()) {
    let parsed: { client_email?: string; private_key?: string };
    try {
      parsed = JSON.parse(body.key) as { client_email?: string; private_key?: string };
    } catch {
      return jsonError(c, 422, "invalid", "הקובץ אינו JSON");
    }
    if (!parsed.client_email || !parsed.private_key) return jsonError(c, 422, "invalid", "חסרים client_email או private_key");
    email = parsed.client_email;
    await prisma.secret.upsert({
      where: { key: "google_service_account" },
      update: { ciphertext: encrypt(body.key) },
      create: { key: "google_service_account", ciphertext: encrypt(body.key) },
    });
  }
  await prisma.setting.upsert({
    where: { key: "googleCalendarId" },
    update: { value: body.calendarId },
    create: { key: "googleCalendarId", value: body.calendarId },
  });
  await resetGoogleSync();
  return c.json({ ok: true, googleHint: email ?? await googleAccountEmail(), calendarId: body.calendarId });
});

settingsRoutes.post("/google/test", async (c) => {
  if (!canWriteBusiness(currentUser(c).role)) return jsonError(c, 401, "forbidden", "אין הרשאה");
  try {
    await testGoogle();
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (reason === "missing") return jsonError(c, 422, "missing", "חסרים מפתח או כתובת יומן");
    if (reason === "shared") return jsonError(c, 422, "shared", "היומן לא משותף עם חשבון השירות");
    return jsonError(c, 422, "invalid", "גוגל לא ענה");
  }
  return c.json({ ok: true });
});

settingsRoutes.put("/secret", async (c) => {
  const body = z.object({ key: z.string(), value: z.string() }).parse(await c.req.json());
  const allowed = body.key === "optive_api_key" ? canWriteBusiness(currentUser(c).role) : canSeeTechnical(currentUser(c).role);
  if (!allowed) return jsonError(c, 401, "forbidden", "אין הרשאה");
  await prisma.secret.upsert({ where: { key: body.key }, update: { ciphertext: encrypt(body.value) }, create: { key: body.key, ciphertext: encrypt(body.value) } });
  return c.json({ ok: true });
});

settingsRoutes.get("/tokens", async (c) => {
  if (!canWriteBusiness(currentUser(c).role)) return jsonError(c, 401, "forbidden", "אין הרשאה");
  const tokens = await prisma.apiToken.findMany({
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, active: true, lastUsedAt: true, createdAt: true },
  });
  return c.json({ tokens });
});

settingsRoutes.post("/tokens", async (c) => {
  if (!canWriteBusiness(currentUser(c).role)) return jsonError(c, 401, "forbidden", "אין הרשאה");
  const body = z.object({ name: z.string().trim().min(1).max(80) }).parse(await c.req.json());
  const token = randomToken();
  const row = await prisma.apiToken.create({ data: { name: body.name, tokenHash: sha256(token) } });
  return c.json({ id: row.id, name: row.name, token, createdAt: row.createdAt });
});

settingsRoutes.patch("/tokens/:id", async (c) => {
  if (!canWriteBusiness(currentUser(c).role)) return jsonError(c, 401, "forbidden", "אין הרשאה");
  const body = z.object({ active: z.boolean() }).parse(await c.req.json());
  const row = await prisma.apiToken.update({ where: { id: c.req.param("id") }, data: { active: body.active } });
  return c.json({ id: row.id, active: row.active });
});

settingsRoutes.delete("/tokens/:id", async (c) => {
  if (!canWriteBusiness(currentUser(c).role)) return jsonError(c, 401, "forbidden", "אין הרשאה");
  await prisma.apiToken.delete({ where: { id: c.req.param("id") } });
  return c.json({ ok: true });
});

settingsRoutes.get("/logs", async (c) => {
  if (!canSeeTechnical(currentUser(c).role)) return jsonError(c, 401, "forbidden", "אין הרשאה");
  const logs = await prisma.systemLog.findMany({ orderBy: { createdAt: "desc" }, take: 200 });
  return c.json({ logs });
});
