import { prisma } from "@noa/db";
import { nextSendAt } from "../../lib/send-window.js";
import { markAttendance } from "../appointments/service.js";
import { markLinkSent } from "../links/service.js";
import { setSalesStatus } from "../pipelines/service.js";
import { prepareJob } from "./prepare.js";
import { deliverMessage } from "./service.js";

const RETRY_MS = [60_000, 5 * 60_000, 30 * 60_000];
let sweeping = false;

export async function runDueJobs() {
  if (sweeping) return { ran: 0 };
  sweeping = true;
  try {
    const due = await prisma.scheduledJob.findMany({
      where: { status: "pending", runAt: { lte: new Date() } },
      include: { automation: true },
      orderBy: { runAt: "asc" },
      take: 30,
    });
    let ran = 0;
    for (const job of due) {
      const claimed = await prisma.scheduledJob.updateMany({
        where: { id: job.id, status: "pending" },
        data: { status: "running" },
      });
      if (claimed.count !== 1) continue;
      await runJob(job);
      ran += 1;
    }
    return { ran };
  } finally {
    sweeping = false;
  }
}

async function runJob(job: {
  id: string;
  contactId: string;
  attempts: number;
  payload: unknown;
  automation: { key: string; active: boolean; messageTemplate: string };
}) {
  const payload = (job.payload ?? {}) as { appointmentId?: string; serviceId?: string };
  if (!job.automation.active && job.automation.key !== "no_show") {
    await prisma.scheduledJob.update({ where: { id: job.id }, data: { status: "cancelled" } });
    return;
  }
  try {
    if (job.automation.key === "no_show" && payload.appointmentId) await markBookedAsMissed(payload.appointmentId);
    if (!job.automation.active) {
      await prisma.scheduledJob.update({ where: { id: job.id }, data: { status: "cancelled" } });
      return;
    }
    const open = nextSendAt(new Date());
    if (open.getTime() > Date.now() + 15_000) {
      await prisma.scheduledJob.update({ where: { id: job.id }, data: { status: "pending", runAt: open } });
      return;
    }
    const prepared = await prepareJob(job.automation.key, job.contactId, payload, job.automation.messageTemplate);
    if (prepared.skip) {
      await prisma.scheduledJob.update({ where: { id: job.id }, data: { status: "cancelled" } });
      return;
    }
    const result = await deliverMessage(job.contactId, prepared.template ?? job.automation.messageTemplate, prepared.vars ?? {}, prepared.facts ?? {});
    if (result.delivered && prepared.linkId) await markLinkSent(prepared.linkId);
    await prisma.scheduledJob.update({ where: { id: job.id }, data: { status: "sent" } });
    if (job.automation.key === "no_answer_3") await setSalesStatus(job.contactId, "לא רלוונטית", "המערכת", "שלושה ניסיונות בלי מענה");
  } catch (error) {
    const attempts = job.attempts + 1;
    const wait = RETRY_MS[Math.min(job.attempts, RETRY_MS.length - 1)] ?? 30 * 60_000;
    await prisma.scheduledJob.update({
      where: { id: job.id },
      data: attempts >= 3
        ? { status: "failed", attempts, lastError: error instanceof Error ? error.message : "send failed" }
        : { status: "pending", attempts, runAt: new Date(Date.now() + wait), lastError: error instanceof Error ? error.message : "send failed" },
    });
  }
}

async function markBookedAsMissed(appointmentId: string) {
  const appointment = await prisma.appointment.findUnique({ where: { id: appointmentId } });
  if (appointment?.status === "נקבע") await markAttendance({ appointmentId, status: "לא הגיעה", actor: "automation" });
}