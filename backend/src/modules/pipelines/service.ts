import { prisma } from "@noa/db";
import {
  formatPhoneDisplay,
  gradeFromVisits,
  isSalesStatus,
  normalizePhone,
  opsLeaveMissing,
  resolveOpsStatus,
  salesTransitionMissing,
  type SalesStatus,
} from "@noa/shared";
import { hebrewDate } from "../../lib/time.js";

export async function addTimeline(contactId: string, type: string, actor: string, payload: object) {
  await prisma.timelineEvent.create({ data: { contactId, type, actor, payload } });
}

export async function recomputeAllServices() {
  const rows = await prisma.contactService.findMany({ select: { contactId: true, serviceId: true } });
  for (const row of rows) await recomputeService(row.contactId, row.serviceId);
}

export async function recomputeService(contactId: string, serviceId: string) {
  const service = await prisma.service.findUniqueOrThrow({ where: { id: serviceId } });
  const arrived = await prisma.appointment.findMany({
    where: { contactId, serviceId, status: "הגיעה" },
    orderBy: { startsAt: "asc" },
  });
  const future = await prisma.appointment.count({
    where: { contactId, serviceId, status: "נקבע", startsAt: { gt: new Date() } },
  });
  const existing = await prisma.contactService.findUnique({ where: { contactId_serviceId: { contactId, serviceId } } });
  if (arrived.length === 0 && !existing) return null;
  const last = arrived.at(-1);
  const days = last ? Math.floor((Date.now() - last.startsAt.getTime()) / 86_400_000) : null;
  const status = resolveOpsStatus({
    visits: arrived.length,
    daysSinceLastVisit: days,
    hasFutureAppointment: future > 0,
    atRiskDays: service.atRiskDays,
    dormantDays: service.dormantDays,
    left: existing?.opsStatus === "עזבה",
  });
  if (!status) return null;
  const row = await prisma.contactService.upsert({
    where: { contactId_serviceId: { contactId, serviceId } },
    update: {
      opsStatus: status,
      firstVisitAt: arrived[0]?.startsAt ?? existing?.firstVisitAt,
      lastVisitAt: last?.startsAt ?? null,
    },
    create: {
      contactId,
      serviceId,
      opsStatus: status,
      firstVisitAt: arrived[0]?.startsAt,
      lastVisitAt: last?.startsAt,
    },
  });
  if (status === "קבועה" && gradeFromVisits(arrived.length) === "קבועה") {
    const { enqueueAutomation } = await import("../automations/service.js");
    await enqueueAutomation({
      key: "became_regular",
      contactId,
      runAt: new Date(),
      idempotencyKey: `regular:${contactId}:${serviceId}`,
      payload: { serviceId },
    });
  }
  return row;
}

export async function setSalesStatus(contactId: string, status: SalesStatus, actor: string, reason?: string | null) {
  if (!isSalesStatus(status)) throw new Error("invalid");
  const missing = salesTransitionMissing(status, reason);
  if (missing) {
    const error = new Error("missing");
    (error as Error & { field?: string }).field = missing;
    throw error;
  }
  const existing = await prisma.contact.findUnique({ where: { id: contactId } });
  if (!existing) throw new Error("not_found");
  if (existing.salesStatus === status && (status !== "לא רלוונטית" || existing.notRelevantReason === (reason ?? null))) {
    return { contact: existing, messageQueued: false };
  }
  const contact = await prisma.contact.update({
    where: { id: contactId },
    data: { salesStatus: status, notRelevantReason: status === "לא רלוונטית" ? reason : undefined },
  });
  await addTimeline(contactId, "status_change", actor, { status, reason: reason ?? null });
  if (status === "לקוחה פעילה") await ensureClientService(contactId);
  let messageQueued = false;
  if (status === "אין מענה 3") {
    const prior = await prisma.scheduledJob.findFirst({
      where: { contactId, idempotencyKey: { startsWith: `no3:${contactId}` }, status: { in: ["pending", "sent", "running"] } },
    });
    if (!prior) {
      const { enqueueAutomation } = await import("../automations/service.js");
      messageQueued = await enqueueAutomation({
        key: "no_answer_3",
        contactId,
        runAt: new Date(),
        idempotencyKey: `no3:${contactId}`,
        payload: {},
      });
    }
  }
  return { contact, messageQueued };
}

async function ensureClientService(contactId: string) {
  const existing = await prisma.contactService.findFirst({ where: { contactId } });
  if (existing) return;
  const appointment = await prisma.appointment.findFirst({
    where: { contactId, status: { not: "בוטל" } },
    orderBy: { startsAt: "desc" },
  });
  if (!appointment) return;
  await prisma.contactService.create({
    data: { contactId, serviceId: appointment.serviceId, opsStatus: "חדשה" },
  });
}

export async function becomeClient(contactId: string, actor: string) {
  const contact = await prisma.contact.findUnique({ where: { id: contactId } });
  if (!contact || contact.salesStatus === "לקוחה פעילה") return false;
  await setSalesStatus(contactId, "לקוחה פעילה", actor);
  return true;
}

export function presentContact(contact: { phone: string; name: string; createdAt: Date; salesStatus: string }) {
  return {
    ...contact,
    phoneDisplay: formatPhoneDisplay(contact.phone),
    enteredAt: hebrewDate(contact.createdAt),
  };
}

export function assertPhone(input: string) {
  return normalizePhone(input);
}

export function leaveGuard(status: string, reason?: string | null) {
  return opsLeaveMissing(status as "עזבה", reason);
}
