import { Prisma } from "@prisma/client";
import { prisma } from "@noa/db";
import { calculatePrice, DISCOUNT_PERCENT } from "@noa/shared";
import { enqueueAutomation, pushFacts, rememberFacts } from "../automations/service.js";
import { clock, hebrewDate } from "../../lib/time.js";
import { addTimeline, becomeClient, recomputeService, setSalesStatus } from "../pipelines/service.js";

function overlap(startsAt: Date, endsAt: Date, ignoreId?: string) {
  return {
    ...(ignoreId ? { id: { not: ignoreId } } : {}),
    status: { not: "בוטל" as const },
    startsAt: { lt: endsAt },
    endsAt: { gt: startsAt },
  };
}

function withCalendarLock<T>(work: (tx: Prisma.TransactionClient) => Promise<T>) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(8421701)`;
    return work(tx);
  });
}

export function placeAppointment(id: string, startsAt: Date, endsAt: Date, data: Prisma.AppointmentUpdateInput) {
  return withCalendarLock(async (tx) => {
    const clash = await tx.appointment.findFirst({ where: overlap(startsAt, endsAt, id) });
    if (clash) throw new Error("taken");
    return tx.appointment.update({ where: { id }, data: { ...data, startsAt, endsAt } });
  });
}

export async function createAppointment(input: {
  contactId: string;
  serviceId: string;
  startsAt: Date;
  endsAt: Date;
  bookedBy: string;
  discountPct?: number;
  motherDaughter?: boolean;
  notes?: string;
  actor?: string;
}) {
  const service = await prisma.service.findUniqueOrThrow({ where: { id: input.serviceId } });
  const discounts = [input.discountPct ?? 0, input.motherDaughter ? 10 : 0].filter((value) => value > 0);
  const price = calculatePrice(service.price, discounts, []);
  const appointment = await withCalendarLock(async (tx) => {
    const clash = await tx.appointment.findFirst({ where: overlap(input.startsAt, input.endsAt) });
    if (clash) throw new Error("taken");
    return tx.appointment.create({
      data: {
        contactId: input.contactId,
        serviceId: input.serviceId,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        bookedBy: input.bookedBy,
        listPrice: service.price,
        discountPct: Math.round(price.discountPct),
        finalPrice: Math.round(price.finalPrice),
        motherDaughter: Boolean(input.motherDaughter),
        notes: input.notes?.trim() || null,
      },
    });
  });
  await addTimeline(input.contactId, "appointment", input.actor ?? "user", { appointmentId: appointment.id, startsAt: input.startsAt });
  await enqueueAutomation({
    key: "no_show",
    contactId: input.contactId,
    runAt: new Date(input.endsAt.getTime() + 2 * 60 * 60 * 1000),
    idempotencyKey: `noshow:${appointment.id}`,
    payload: { appointmentId: appointment.id },
  });
  if (service.hasForYou) {
    const filled = await prisma.questionnaireResponse.findUnique({
      where: { contactId_serviceId: { contactId: input.contactId, serviceId: input.serviceId } },
    });
    if (!filled) {
      const lead = 20 * 60 * 1000;
      const runAt = new Date(Math.max(Date.now(), input.startsAt.getTime() - lead));
      await enqueueAutomation({
        key: "beshvilech",
        contactId: input.contactId,
        runAt,
        idempotencyKey: `foryou:${input.contactId}:${input.serviceId}`,
        payload: { appointmentId: appointment.id, serviceId: input.serviceId },
      });
    }
  }
  await becomeClient(input.contactId, input.actor ?? input.bookedBy);
  await rememberAppointment(appointment.id, "נקבע");
  return appointment;
}

export async function rememberAppointment(id: string, kind: "נקבע" | "זז" | "בוטל") {
  const row = await prisma.appointment.findUnique({ where: { id }, include: { contact: true, service: true } });
  if (!row) return;
  const start = `${hebrewDate(row.startsAt)} בשעה ${clock(row.startsAt)}`;
  const end = clock(row.endsAt);
  const what = kind === "נקבע"
    ? `נקבע תור ${row.service.name}. ההתחלה ${start}, והסיום ${end}.`
    : kind === "זז"
      ? `התור של ${row.service.name} זז. ההתחלה ${start}, והסיום ${end}.`
      : `התור של ${row.service.name} בוטל. הוא היה ${start}.`;
  await rememberFacts(row.contactId, pushFacts(what, { שירות: row.service.name, "מתי מתחיל": start, "מתי נגמר": end }));
}

export async function cancelAppointment(id: string, actor: string) {
  const appointment = await prisma.appointment.findUnique({ where: { id } });
  if (!appointment) return null;
  if (appointment.status !== "בוטל") {
    await prisma.appointment.update({ where: { id }, data: { status: "בוטל" } });
    await prisma.scheduledJob.updateMany({
      where: { status: "pending", idempotencyKey: { in: [`noshow:${id}`, `discount:${id}`] } },
      data: { status: "cancelled" },
    });
    await recomputeService(appointment.contactId, appointment.serviceId);
    await addTimeline(appointment.contactId, "appointment", actor, { appointmentId: id, cancelled: true, startsAt: appointment.startsAt });
    await rememberAppointment(id, "בוטל");
  }
  return appointment;
}

export async function markAttendance(input: {
  appointmentId: string;
  status: "הגיעה" | "לא הגיעה" | "נקבע";
  actor: string;
  paymentMethod?: string | null;
  amountPaid?: number | null;
  completionsCount?: number | null;
  notes?: string | null;
}) {
  const appointment = await prisma.appointment.findUnique({ where: { id: input.appointmentId }, include: { service: true, contact: true } });
  if (!appointment) throw new Error("not_found");
  const firstArrival = input.status === "הגיעה" && appointment.status !== "הגיעה";
  const price = firstArrival
    ? await applyCredits(appointment.contactId, appointment.id, appointment.listPrice, appointment.discountPct, input.completionsCount ?? 0)
    : calculatePrice(appointment.listPrice, [appointment.discountPct], [], input.completionsCount ?? 0);
  const collected = input.status === "הגיעה"
    ? Math.round(input.amountPaid ?? (firstArrival ? price.finalPrice : appointment.amountPaid ?? price.finalPrice))
    : null;
  await prisma.appointment.update({
    where: { id: appointment.id },
    data: {
      status: input.status,
      paymentMethod: input.paymentMethod ?? (input.status === "הגיעה" ? appointment.paymentMethod : null),
      amountPaid: collected,
      completionsCount: input.completionsCount ?? null,
      notes: input.notes ?? appointment.notes,
      finalPrice: collected ?? appointment.finalPrice,
    },
  });
  if (input.notes) await addTimeline(appointment.contactId, "note", input.actor, { appointmentId: appointment.id, text: input.notes });
  const changes: { field: string; from: string; to: string }[] = [];
  if (input.status !== appointment.status) changes.push({ field: "הגעה", from: appointment.status, to: input.status });
  if (input.status === "הגיעה" && collected !== appointment.amountPaid) {
    changes.push({
      field: "תשלום",
      from: appointment.amountPaid == null ? "" : `${appointment.amountPaid}₪${appointment.paymentMethod ? ` ב${appointment.paymentMethod}` : ""}`,
      to: `${collected}₪${input.paymentMethod ? ` ב${input.paymentMethod}` : ""}`,
    });
  }
  if (changes.length) await addTimeline(appointment.contactId, "field_change", input.actor, { changes });
  await recomputeService(appointment.contactId, appointment.serviceId);
  const arrivedCount = await prisma.appointment.count({ where: { contactId: appointment.contactId, status: "הגיעה" } });
  if (input.status === "הגיעה" && appointment.contact.salesStatus !== "לקוחה פעילה" && arrivedCount >= 1) {
    await setSalesStatus(appointment.contactId, "לקוחה פעילה", "system");
  }
  if (input.status === "הגיעה" && arrivedCount === 1 && appointment.contact.referredById) {
    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + 3);
    await prisma.credit.create({
      data: { contactId: appointment.contact.referredById, percent: 10, remainingPct: 10, expiresAt },
    });
  }
  if (input.status === "לא הגיעה" && appointment.status !== "לא הגיעה") {
    await prisma.contact.update({ where: { id: appointment.contactId }, data: { noShowCount: { increment: 1 } } });
    if (appointment.contact.salesStatus !== "לקוחה פעילה") await setSalesStatus(appointment.contactId, "לא הגיעה", "system");
    await prisma.scheduledJob.updateMany({
      where: { idempotencyKey: `noshow:${appointment.id}`, status: "pending" },
      data: { runAt: new Date() },
    });
  }
  if (input.status === "הגיעה" || input.status === "נקבע") {
    await prisma.scheduledJob.updateMany({
      where: { idempotencyKey: `noshow:${appointment.id}`, status: "pending" },
      data: { status: "cancelled" },
    });
  }
  let messageQueued = false;
  if (firstArrival) {
    messageQueued = await enqueueAutomation({
      key: "discount",
      contactId: appointment.contactId,
      runAt: new Date(),
      idempotencyKey: `discount:${appointment.id}`,
      payload: { appointmentId: appointment.id, serviceId: appointment.serviceId },
    });
  }
  const saved = await prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id }, include: { service: true, contact: true } });
  return { ...saved, messageQueued };
}

async function applyCredits(contactId: string, appointmentId: string, listPrice: number, discountPct: number, completions: number) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${appointmentId}))`;
    const already = await tx.creditRedemption.findFirst({ where: { appointmentId } });
    if (already) return calculatePrice(listPrice, [discountPct], [], completions);
    const credits = await tx.credit.findMany({
      where: { contactId, expiresAt: { gt: new Date() }, remainingPct: { gt: 0 } },
      orderBy: { expiresAt: "asc" },
    });
    let room = Math.max(0, 50 - discountPct);
    const takes: { id: string; take: number }[] = [];
    for (const credit of credits) {
      if (room <= 0) break;
      const take = Math.min(room, credit.remainingPct);
      if (take <= 0) continue;
      takes.push({ id: credit.id, take });
      room -= take;
    }
    const price = calculatePrice(listPrice, [discountPct], takes.map((item) => item.take), completions);
    for (const used of takes) {
      await tx.credit.update({ where: { id: used.id }, data: { remainingPct: { decrement: used.take } } });
      await tx.creditRedemption.create({ data: { creditId: used.id, appointmentId, percentUsed: used.take } });
    }
    return price;
  });
}

export { DISCOUNT_PERCENT };
