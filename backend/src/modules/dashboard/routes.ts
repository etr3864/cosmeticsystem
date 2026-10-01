import { Hono } from "hono";
import { prisma } from "@noa/db";
import { requireUser } from "../../http/session.js";

export const dashboardRoutes = new Hono();
dashboardRoutes.use("*", requireUser);

dashboardRoutes.get("/", async (c) => {
  const now = new Date();
  const from = new Date(c.req.query("from") ?? new Date(now.getFullYear(), now.getMonth(), 1).toISOString());
  const to = new Date(c.req.query("to") ?? now.toISOString());
  const month = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, "0")}`;
  const entered = { createdAt: { gte: from, lte: to } };
  const showedUp = { some: { status: "הגיעה" as const, startsAt: { gte: from, lte: to } } };
  const [leads, booked, arrived, noShow, payments, spend, active, regulars, atRisk, dormant, newCustomers, arrivedFromLeads, credits] = await Promise.all([
    prisma.contact.count({ where: entered }),
    prisma.contact.count({ where: { ...entered, salesStatus: { in: ["נקבע תור AI", "נקבע תור אנושי", "לקוחה פעילה", "לא הגיעה"] } } }),
    prisma.appointment.count({ where: { status: "הגיעה", startsAt: { gte: from, lte: to } } }),
    prisma.appointment.count({ where: { status: "לא הגיעה", startsAt: { gte: from, lte: to } } }),
    prisma.appointment.aggregate({ where: { status: "הגיעה", startsAt: { gte: from, lte: to } }, _sum: { amountPaid: true } }),
    prisma.campaignSpend.aggregate({ where: { month }, _sum: { amount: true } }),
    prisma.contact.count({ where: { salesStatus: "לקוחה פעילה" } }),
    prisma.contactService.count({ where: { opsStatus: "קבועה" } }),
    prisma.contactService.count({ where: { opsStatus: "בסיכון" } }),
    prisma.contactService.count({ where: { opsStatus: "רדומה" } }),
    prisma.contact.count({
      where: { appointments: { ...showedUp, none: { status: "הגיעה", startsAt: { lt: from } } } },
    }),
    prisma.contact.count({ where: { ...entered, appointments: showedUp } }),
    prisma.credit.aggregate({ where: { expiresAt: { gt: now }, remainingPct: { gt: 0 } }, _sum: { remainingPct: true } }),
  ]);
  const spent = spend._sum.amount ?? 0;
  const visits = arrived + noShow;
  return c.json({
    from,
    to,
    income: payments._sum.amountPaid ?? 0,
    marketing: {
      leads,
      spend: spent,
      cpl: leads ? Math.round(spent / leads) : 0,
      cac: newCustomers ? Math.round(spent / newCustomers) : 0,
    },
    sales: {
      booked,
      arrived: arrivedFromLeads,
      leadToBook: leads ? Math.round((booked / leads) * 100) : 0,
      leadToArrive: leads ? Math.round((arrivedFromLeads / leads) * 100) : 0,
    },
    operations: {
      arrived,
      noShow,
      showRate: visits ? Math.round((arrived / visits) * 100) : 0,
      atRisk,
      dormant,
    },
    clients: { active, regulars, credits: credits._sum.remainingPct ?? 0 },
  });
});
