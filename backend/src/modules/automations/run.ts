import { prisma } from "@noa/db";
import { DISCOUNT_PERCENT, MESSAGE_DEFAULTS, priceAfterPercent } from "@noa/shared";
import { deliverMessage } from "./service.js";
import { ensureLink, markLinkSent } from "../links/service.js";
import { hebrewDate } from "../../lib/time.js";
import { setSalesStatus } from "../pipelines/service.js";
import { markAttendance } from "../appointments/service.js";

export async function runDueJobs() {
  const jobs = await prisma.scheduledJob.findMany({
    where: { status: "pending", runAt: { lte: new Date() } },
    include: { automation: true },
    take: 30,
    orderBy: { runAt: "asc" },
  });
  for (const job of jobs) {
    try {
      await runJob(job.id);
    } catch (error) {
      await prisma.scheduledJob.update({
        where: { id: job.id },
        data: { attempts: { increment: 1 }, lastError: error instanceof Error ? error.message : "failed", status: job.attempts >= 2 ? "failed" : "pending" },
      });
    }
  }
}

async function runJob(id: string) {
  const job = await prisma.scheduledJob.findUniqueOrThrow({ where: { id }, include: { automation: true, contact: true } });
  if (job.status !== "pending") return;
  const payload = job.payload as { appointmentId?: string; serviceId?: string };
  const vars = await buildVars(job.automation.key, job.contactId, job.contact.name, payload, job.automation.messageTemplate);
  if (vars.skip) {
    await prisma.scheduledJob.update({ where: { id }, data: { status: "cancelled" } });
    return;
  }
  const sent = await deliverMessage(job.contactId, vars.template, vars.vars as Record<string, string>);
  const linkId = "linkId" in vars ? vars.linkId : undefined;
  if (sent.delivered && linkId) await markLinkSent(linkId);
  await prisma.scheduledJob.update({ where: { id }, data: { status: "sent" } });
  if (job.automation.key === "no_answer_3") {
    await setSalesStatus(job.contactId, "לא רלוונטית", "automation", "שלושה ניסיונות בלי מענה");
  }
}

async function buildVars(key: string, contactId: string, name: string, payload: { appointmentId?: string; serviceId?: string }, template: string) {
  if (key === "beshvilech" && payload.serviceId) {
    if (payload.appointmentId) {
      const linked = await prisma.appointment.findUnique({ where: { id: payload.appointmentId } });
      if (!linked || linked.status === "בוטל") {
        const other = await prisma.appointment.findFirst({
          where: { contactId, serviceId: payload.serviceId, status: "נקבע", startsAt: { gt: new Date() } },
        });
        if (!other) return { skip: true, vars: {}, template };
      }
    }
    const filled = await prisma.questionnaireResponse.findUnique({
      where: { contactId_serviceId: { contactId, serviceId: payload.serviceId } },
    });
    if (filled) return { skip: true, vars: {}, template };
    const link = await ensureLink(contactId, "questionnaire");
    return { skip: false, template, vars: { שם: name, קישור: link.url }, linkId: link.id };
  }
  if (key === "discount" && payload.serviceId) {
    const service = await prisma.service.findUniqueOrThrow({ where: { id: payload.serviceId } });
    const future = await prisma.appointment.count({
      where: { contactId, status: "נקבע", startsAt: { gt: new Date() }, id: payload.appointmentId ? { not: payload.appointmentId } : undefined },
    });
    const link = await ensureLink(contactId, "discount_booking");
    const chosen = future > 0 ? MESSAGE_DEFAULTS.discountExisting : template;
    return {
      skip: false,
      template: chosen,
      linkId: link.id,
      vars: {
        שם: name,
        קישור: link.url,
        מחיר: String(service.price),
        מחיר_אחרי: String(priceAfterPercent(service.price, DISCOUNT_PERCENT)),
      },
    };
  }
  if (key === "no_show" && payload.appointmentId) {
    const appointment = await prisma.appointment.findUnique({ where: { id: payload.appointmentId } });
    if (!appointment || (appointment.status !== "נקבע" && appointment.status !== "לא הגיעה")) return { skip: true, vars: {}, template };
    if (appointment.status === "נקבע") await markAttendance({ appointmentId: appointment.id, status: "לא הגיעה", actor: "automation" });
    return { skip: false, template, vars: { שם: name, תאריך: hebrewDate(appointment.startsAt) } };
  }
  if (key === "became_regular" || key === "partner_link") {
    const link = await ensureLink(contactId, "referral");
    return { skip: false, template, vars: { שם: name, קישור: link.url }, linkId: link.id };
  }
  return { skip: false, template, vars: { שם: name } };
}
