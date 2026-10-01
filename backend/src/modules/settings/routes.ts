import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "@noa/db";
import { calculatePrice, canSeeTechnical } from "@noa/shared";
import { requireUser, currentUser } from "../../http/session.js";
import { jsonError } from "../../http/errors.js";
import { encrypt } from "../../lib/crypto.js";

export const settingsRoutes = new Hono();
settingsRoutes.use("*", requireUser);

settingsRoutes.get("/", async (c) => {
  const [settings, services, automations, campaigns] = await Promise.all([
    prisma.setting.findMany(),
    prisma.service.findMany({ orderBy: { name: "asc" } }),
    prisma.automation.findMany({ orderBy: { key: "asc" } }),
    prisma.campaign.findMany({ include: { spend: true } }),
  ]);
  return c.json({
    settings: Object.fromEntries(settings.map((item) => [item.key, item.value])),
    services,
    automations,
    campaigns,
    technical: canSeeTechnical(currentUser(c).role),
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
    for (const row of rows) {
      const endsAt = new Date(row.startsAt.getTime() + body.durationMin * 60000);
      if (endsAt.getTime() === row.endsAt.getTime()) continue;
      await prisma.appointment.update({ where: { id: row.id }, data: { endsAt } });
      await prisma.scheduledJob.updateMany({
        where: { idempotencyKey: `noshow:${row.id}`, status: "pending" },
        data: { runAt: new Date(endsAt.getTime() + 2 * 60 * 60 * 1000) },
      });
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
    await prisma.campaignSpend.update({ where: { id: existing[0].id }, data: { amount: body.amount } });
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

settingsRoutes.put("/secret", async (c) => {
  if (!canSeeTechnical(currentUser(c).role)) return jsonError(c, 401, "forbidden", "אין הרשאה");
  const body = z.object({ key: z.string(), value: z.string() }).parse(await c.req.json());
  await prisma.secret.upsert({ where: { key: body.key }, update: { ciphertext: encrypt(body.value) }, create: { key: body.key, ciphertext: encrypt(body.value) } });
  return c.json({ ok: true });
});

settingsRoutes.get("/logs", async (c) => {
  if (!canSeeTechnical(currentUser(c).role)) return jsonError(c, 401, "forbidden", "אין הרשאה");
  const logs = await prisma.systemLog.findMany({ orderBy: { createdAt: "desc" }, take: 200 });
  return c.json({ logs });
});
