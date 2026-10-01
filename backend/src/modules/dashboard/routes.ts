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
  const [leads, booked, arrived, noShow, payments, spend, active, regulars, atRisk, dormant, newClients, arrivedLeads, credits] = await Promise.all([
    prisma.contact.count({ where: { createdAt: { gte: from, lte: to }, salesStatus: { not: "לקוחה פעילה" } } }),
    prisma.contact.count({ where: { createdAt: { gte: from, lte: to }, salesStatus: { in: ["נקבע תור AI", "נקבע תור אנושי", "לקוחה פעילה", "לא הגיעה"] } } }),
    prisma.appointment.count({ where: { status: "הגיעה", startsAt: { gte: from, lte: to } } }),
    prisma.appointment.count({ where: { status: "לא הגיעה", startsAt: { gte: from, lte: to } } }),
    prisma.appointment.aggregate({ where: { status: "הגיעה", startsAt: { gte: from, lte: to } }, _sum: { amountPaid: true } }),
    prisma.campaignSpend.aggregate({ where: { month }, _sum: { amount: true } }),
    prisma.contact.count({ where: { salesStatus: "לקוחה פעילה" } }),
    prisma.contactService.count({ where: { opsStatus: "קבועה" } }),
    prisma.contactService.count({ where: { opsStatus: "בסיכון" } }),
    prisma.contactService.count({ where: { opsStatus: "רדומה" } }),
    prisma.contactService.count({ where: { firstVisitAt: { gte: from, lte: to } } }),
    prisma.contact.count({ where: { createdAt: { gte: from, lte: to }, appointments: { some: { status: "הגיעה" } } } }),
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
      cac: newClients ? Math.round(spent / newClients) : 0,
    },
    sales: {
      booked,
      leadToBook: leads ? Math.round((booked / leads) * 100) : 0,
      leadToArrive: leads ? Math.round((arrivedLeads / leads) * 100) : 0,
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
