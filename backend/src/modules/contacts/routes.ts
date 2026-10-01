import { Hono } from "hono";
import { z } from "zod";
import Papa from "papaparse";
import { prisma } from "@noa/db";
import { formatPhoneDisplay, isSalesStatus, normalizePhone, PAGE_SIZE, salesTransitionMissing, toConversationPhone } from "@noa/shared";
import { requireUser, currentUser } from "../../http/session.js";
import { jsonError } from "../../http/errors.js";
import { addTimeline, leaveGuard, setSalesStatus } from "../pipelines/service.js";
import { createContactLink, isLinkKind, linkLabel, listLinks, revokeLink, sendContactLink, type LinkKind } from "../links/service.js";

const leadJourney = ["ליד חדש", "אין מענה ל-AI", "אין מענה 1", "אין מענה 2", "אין מענה 3", "נקבע תור AI", "נקבע תור אנושי", "לא הגיעה", "לא רלוונטית"];

function byLeadJourney<T extends { salesStatus: string; createdAt: Date }>(rows: T[]) {
  const rank = (status: string) => {
    const index = leadJourney.indexOf(status);
    return index === -1 ? leadJourney.length : index;
  };
  return [...rows].sort((a, b) => rank(a.salesStatus) - rank(b.salesStatus) || b.createdAt.getTime() - a.createdAt.getTime());
}

function searchNeedles(q: string) {
  const name = { name: { contains: q, mode: "insensitive" as const } };
  const digits = q.replace(/\D/g, "");
  if (digits.length < 2) return [name];
  let needle = digits.startsWith("972") ? digits.slice(3) : digits;
  if (needle.startsWith("0")) needle = needle.slice(1);
  if (!needle) return [name];
  return [name, { phone: { contains: needle } }];
}

export const contactRoutes = new Hono();
contactRoutes.use("*", requireUser);

contactRoutes.get("/", async (c) => {
  const kind = c.req.query("kind") === "client" ? "client" : c.req.query("kind") === "all" ? "all" : "lead";
  const page = Number(c.req.query("page") ?? 1);
  const pageSize = PAGE_SIZE;
  const q = c.req.query("q")?.trim();
  const statuses = c.req.query("status")?.split(",").filter(Boolean) ?? [];
  const source = c.req.query("source");
  const serviceCode = c.req.query("service");
  const ops = c.req.query("ops");
  const where = {
    ...(kind === "lead" ? { salesStatus: { not: "לקוחה פעילה" } } : {}),
    ...(kind === "client" ? { salesStatus: "לקוחה פעילה" } : {}),
    ...(statuses.length ? { salesStatus: { in: statuses } } : {}),
    ...(source ? { source } : {}),
    ...(ops ? { services: { some: { opsStatus: ops } } } : {}),
    ...(q ? { OR: searchNeedles(q) } : {}),
    ...(kind === "client" && serviceCode ? { services: { some: { service: { code: serviceCode } } } } : {}),
  };
  const include = { services: { include: { service: true } }, appointments: true, credits: true } as const;
  let total = 0;
  let rows: Awaited<ReturnType<typeof prisma.contact.findMany<{ include: typeof include }>>> = [];
  if (kind === "lead") {
    const ranked = byLeadJourney(await prisma.contact.findMany({ where, select: { id: true, salesStatus: true, createdAt: true } }));
    const ids = ranked.map((row) => row.id);
    if (c.req.query("idsOnly") === "1") return c.json({ ids: ids.slice(0, 2000), total: ids.length });
    total = ids.length;
    const pageIds = ids.slice((page - 1) * pageSize, page * pageSize);
    const found = pageIds.length ? await prisma.contact.findMany({ where: { id: { in: pageIds } }, include }) : [];
    const byId = new Map(found.map((row) => [row.id, row]));
    rows = pageIds.flatMap((id) => { const row = byId.get(id); return row ? [row] : []; });
  } else if (c.req.query("idsOnly") === "1") {
    const ids = await prisma.contact.findMany({ where, select: { id: true }, take: 2000, orderBy: { createdAt: "desc" } });
    return c.json({ ids: ids.map((row) => row.id), total: ids.length });
  } else {
    const [count, found] = await Promise.all([
      prisma.contact.count({ where }),
      prisma.contact.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include,
      }),
    ]);
    total = count;
    rows = found;
  }
  return c.json({
    page,
    pageSize,
    total,
    items: rows.map((row) => ({
      id: row.id,
      name: row.name,
      phone: formatPhoneDisplay(row.phone),
      phoneRaw: row.phone,
      conversationPhone: toConversationPhone(row.phone),
      salesStatus: row.salesStatus,
      source: row.source,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      services: row.services.map((item) => ({
        serviceId: item.serviceId,
        code: item.service.code,
        name: item.service.name,
        status: item.opsStatus,
        firstVisitAt: item.firstVisitAt,
        lastVisitAt: item.lastVisitAt,
      })),
      visits: row.appointments.filter((item) => item.status === "הגיעה").length,
      booked: row.appointments.some((item) => item.status === "נקבע"),
      nextVisit: row.appointments.filter((item) => item.status === "נקבע" && item.startsAt > new Date()).sort((a, b) => +a.startsAt - +b.startsAt)[0]?.startsAt ?? null,
      credits: row.credits.filter((item) => item.expiresAt > new Date()).reduce((sum, item) => sum + item.remainingPct, 0),
    })),
  });
});

contactRoutes.get("/:id", async (c) => {
  const contact = await prisma.contact.findUnique({
    where: { id: c.req.param("id") },
    include: {
      services: { include: { service: true } },
      appointments: { include: { service: true }, orderBy: { startsAt: "desc" } },
      timeline: { orderBy: { createdAt: "desc" }, take: 100 },
      responses: true,
      credits: true,
      campaign: true,
      referredBy: true,
    },
  });
  if (!contact) return jsonError(c, 404, "not_found", "לא נמצא");
  const agent = await prisma.setting.findUnique({ where: { key: "optiveAgentId" } });
  const nails = await prisma.service.findUnique({ where: { code: "NAILS" }, include: { questionnaire: true } });
  const rawQuestions = nails?.questionnaire?.questions;
  const questions = Array.isArray(rawQuestions) ? rawQuestions as { id: string; label: string }[] : [];
  const response = nails ? contact.responses.find((item) => item.serviceId === nails.id) : undefined;
  const answers = (response?.answers ?? {}) as Record<string, string>;
  const hasNails = contact.services.some((item) => item.service.code === "NAILS") || contact.appointments.some((item) => item.service.code === "NAILS");
  return c.json({
    ...contact,
    phoneDisplay: formatPhoneDisplay(contact.phone),
    conversationUrl: `https://app.0ptive.com/agent/${String(agent?.value ?? "32").replace(/"/g, "")}?conv=${toConversationPhone(contact.phone)}`,
    forYou: {
      applies: hasNails,
      filled: Boolean(response),
      items: questions.map((question) => ({ label: question.label, value: answers[question.id] ?? "" })).filter((item) => item.value),
    },
    links: await listLinks(contact.id),
  });
});

contactRoutes.post("/:id/links", async (c) => {
  const body = z.object({ kind: z.string(), replace: z.boolean().optional() }).parse(await c.req.json());
  if (!isLinkKind(body.kind)) return jsonError(c, 400, "invalid", "סוג קישור לא מוכר");
  try {
    const link = await createContactLink(c.req.param("id"), body.kind, Boolean(body.replace));
    if (link.fresh) await rememberLink(c.req.param("id"), currentUser(c).username, body.kind, "נוצר");
    return c.json(link, link.fresh ? 201 : 200);
  } catch (error) {
    if (error instanceof Error && error.message === "filled") return jsonError(c, 422, "taken", "כבר מילאו יחד");
    throw error;
  }
});

contactRoutes.post("/:id/links/send", async (c) => {
  const body = z.object({ kind: z.string() }).parse(await c.req.json());
  if (!isLinkKind(body.kind)) return jsonError(c, 400, "invalid", "סוג קישור לא מוכר");
  try {
    const link = await sendContactLink(c.req.param("id"), body.kind);
    await rememberLink(c.req.param("id"), currentUser(c).username, body.kind, link.fresh ? "נוצר ונשלח" : "נשלח");
    return c.json({ ...link, willSend: link.delivered });
  } catch (error) {
    if (error instanceof Error && error.message === "filled") return jsonError(c, 422, "taken", "כבר מילאו יחד");
    if (error instanceof Error && error.message === "paused") return jsonError(c, 422, "paused", "השליחה כבויה בהגדרות");
    throw error;
  }
});

contactRoutes.post("/:id/links/:linkId/revoke", async (c) => {
  const kind = await revokeLink(c.req.param("id"), c.req.param("linkId"));
  if (!kind) return jsonError(c, 404, "not_found", "הקישור לא נמצא");
  if (isLinkKind(kind)) await rememberLink(c.req.param("id"), currentUser(c).username, kind, "בוטל");
  return c.json({ ok: true });
});

contactRoutes.post("/:id/for-you", async (c) => {
  try {
    const link = await sendContactLink(c.req.param("id"), "questionnaire");
    await rememberLink(c.req.param("id"), currentUser(c).username, "questionnaire", link.fresh ? "נוצר ונשלח" : "נשלח");
    return c.json({ ...link, willSend: link.delivered });
  } catch (error) {
    if (error instanceof Error && error.message === "filled") return jsonError(c, 422, "taken", "כבר מילאו יחד");
    if (error instanceof Error && error.message === "paused") return jsonError(c, 422, "paused", "השליחה כבויה בהגדרות");
    throw error;
  }
});

const SOURCES_TUPLE = ["מודעה ממומנת", "המלצה מלקוחה", "קבוצת וואטסאפ", "אינסטגרם אורגני", "פנייה ישירה לנועה", "אחר"] as const;

const createSchema = z.object({
  name: z.string().min(1),
  phone: z.string().min(1),
  source: z.enum(SOURCES_TUPLE),
  sourceDetail: z.string().optional(),
  campaignId: z.string().optional(),
});

contactRoutes.post("/", async (c) => {
  const body = createSchema.parse(await c.req.json());
  const phone = normalizePhone(body.phone);
  const contact = await prisma.contact.create({
    data: { name: body.name, phone, source: body.source, sourceDetail: body.sourceDetail, campaignId: body.campaignId, salesStatus: "ליד חדש" },
  });
  await addTimeline(contact.id, "field_change", currentUser(c).username, { created: true });
  return c.json(contact, 201);
});

contactRoutes.patch("/:id", async (c) => {
  const body = z.object({
    name: z.string().optional(),
    phone: z.string().optional(),
    source: z.string().optional(),
    sourceDetail: z.string().optional(),
    salesStatus: z.string().optional(),
    reason: z.string().optional(),
    note: z.string().optional(),
    opsStatus: z.string().optional(),
    serviceId: z.string().optional(),
    addServiceId: z.string().optional(),
    leftReason: z.string().optional(),
  }).parse(await c.req.json());
  const id = c.req.param("id");
  const actor = currentUser(c).username;
  let messageQueued = false;
  if (body.salesStatus) {
    const saved = await setSalesStatus(id, body.salesStatus as "ליד חדש", actor, body.reason);
    messageQueued = saved.messageQueued;
  }
  if (body.opsStatus && body.serviceId) {
    const missing = leaveGuard(body.opsStatus, body.leftReason);
    if (missing) return jsonError(c, 422, "missing", "חסרה סיבת עזיבה", "leftReason");
    await prisma.contactService.update({ where: { contactId_serviceId: { contactId: id, serviceId: body.serviceId } }, data: { opsStatus: body.opsStatus, leftReason: body.leftReason } });
    await addTimeline(id, "status_change", actor, { status: body.opsStatus, reason: body.leftReason ?? null });
  }
  if (body.addServiceId) {
    const service = await prisma.service.findUnique({ where: { id: body.addServiceId } });
    if (!service) return jsonError(c, 422, "missing", "סוג השירות לא נמצא", "addServiceId");
    await prisma.contactService.upsert({
      where: { contactId_serviceId: { contactId: id, serviceId: service.id } },
      update: {},
      create: { contactId: id, serviceId: service.id, opsStatus: "חדשה" },
    });
    await addTimeline(id, "field_change", actor, { service: service.name });
  }
  if (body.note) await addTimeline(id, "note", actor, { text: body.note });
  const editing = body.name !== undefined || body.phone !== undefined || body.source !== undefined || body.sourceDetail !== undefined;
  if (editing) {
    const current = await prisma.contact.findUnique({ where: { id } });
    if (!current) return jsonError(c, 404, "not_found", "לא נמצא");
    const fields: { name?: string; phone?: string; source?: string; sourceDetail?: string | null } = {};
    const changes: { field: string; from: string; to: string }[] = [];
    if (body.name?.trim() && body.name.trim() !== current.name) {
      fields.name = body.name.trim();
      changes.push({ field: "שם", from: current.name, to: fields.name });
    }
    if (body.source && body.source !== current.source) {
      fields.source = body.source;
      changes.push({ field: "מקור", from: current.source, to: body.source });
    }
    if (body.sourceDetail !== undefined) {
      const detail = body.sourceDetail.trim() || null;
      if (detail !== current.sourceDetail) {
        fields.sourceDetail = detail;
        changes.push({ field: "פירוט המקור", from: current.sourceDetail ?? "", to: detail ?? "" });
      }
    }
    if (body.phone) {
      const phone = normalizePhone(body.phone);
      const taken = await prisma.contact.findFirst({ where: { phone, NOT: { id } } });
      if (taken) return jsonError(c, 422, "taken", "המספר כבר שמור על כרטיס אחר", "phone");
      if (phone !== current.phone) {
        fields.phone = phone;
        changes.push({ field: "טלפון", from: formatPhoneDisplay(current.phone), to: formatPhoneDisplay(phone) });
      }
    }
    if (Object.keys(fields).length) await prisma.contact.update({ where: { id }, data: fields });
    if (changes.length) await addTimeline(id, "field_change", actor, { changes });
  }
  return c.json({ ok: true, messageQueued });
});

contactRoutes.post("/bulk", async (c) => {
  const body = z.object({
    ids: z.array(z.string()).min(1),
    salesStatus: z.string().optional(),
    opsStatus: z.string().optional(),
    reason: z.string().optional(),
    leftReason: z.string().optional(),
  }).parse(await c.req.json());
  if (body.opsStatus === "עזבה") {
    if (!body.leftReason) return jsonError(c, 422, "missing", "חסרה סיבת עזיבה", "leftReason");
    const actor = currentUser(c).username;
    const nails = await prisma.service.findFirst({ where: { code: "NAILS" } });
    for (const id of body.ids) {
      const services = await prisma.contactService.findMany({ where: { contactId: id } });
      const targets = services.length ? services.map((item) => item.serviceId) : nails ? [nails.id] : [];
      for (const serviceId of targets) {
        await prisma.contactService.upsert({
          where: { contactId_serviceId: { contactId: id, serviceId } },
          update: { opsStatus: "עזבה", leftReason: body.leftReason },
          create: { contactId: id, serviceId, opsStatus: "עזבה", leftReason: body.leftReason },
        });
      }
      await addTimeline(id, "status_change", actor, { status: "עזבה", reason: body.leftReason });
    }
    return c.json({ done: body.ids.length, messages: 0 });
  }
  if (!body.salesStatus || !isSalesStatus(body.salesStatus)) return jsonError(c, 400, "invalid", "סטטוס לא מוכר");
  const missing = salesTransitionMissing(body.salesStatus, body.reason);
  if (missing) return jsonError(c, 422, "missing", "חסרה סיבה", missing);
  const actor = currentUser(c).username;
  let messages = 0;
  for (const id of body.ids) {
    const saved = await setSalesStatus(id, body.salesStatus, actor, body.reason);
    if (saved.messageQueued) messages += 1;
  }
  return c.json({ done: body.ids.length, messages });
});

async function importRows(rows: Record<string, string>[]) {
  let created = 0;
  const skipped: string[] = [];
  for (const row of rows) {
    const rawPhone = String(row.phone || row["טלפון"] || "");
    const name = String(row.name || row["שם"] || "");
    if (!rawPhone || !name) continue;
    try {
      const phone = normalizePhone(rawPhone);
      const exists = await prisma.contact.findUnique({ where: { phone } });
      if (exists) {
        skipped.push(formatPhoneDisplay(phone));
        continue;
      }
      await prisma.contact.create({ data: { name, phone, source: row.source || row["מקור"] || "אחר", salesStatus: "ליד חדש" } });
      created += 1;
    } catch {
      skipped.push(rawPhone);
    }
  }
  return { created, skipped };
}

contactRoutes.post("/import", async (c) => {
  const body = z.object({
    csv: z.string().optional(),
    rows: z.array(z.record(z.string())).optional(),
  }).parse(await c.req.json());
  const rows = body.rows ?? Papa.parse<Record<string, string>>(body.csv ?? "", { header: true, skipEmptyLines: true }).data;
  return c.json(await importRows(rows));
});

contactRoutes.get("/export/file", async (c) => {
  const kind = c.req.query("kind") === "client" ? "client" : "lead";
  const status = c.req.query("status");
  const rows = await prisma.contact.findMany({
    where: {
      ...(kind === "lead" ? { salesStatus: { not: "לקוחה פעילה" } } : { salesStatus: "לקוחה פעילה" }),
      ...(status ? { salesStatus: status } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
  const csv = Papa.unparse(rows.map((row) => ({ שם: row.name, טלפון: formatPhoneDisplay(row.phone), סטטוס: row.salesStatus, מקור: row.source, כניסה: row.createdAt.toISOString() })));
  return c.text(csv, 200, { "Content-Type": "text/csv; charset=utf-8" });
});

contactRoutes.post("/:id/partner-link", async (c) => {
  try {
    const link = await sendContactLink(c.req.param("id"), "referral");
    await rememberLink(c.req.param("id"), currentUser(c).username, "referral", link.fresh ? "נוצר ונשלח" : "נשלח");
    return c.json({ ...link, willSend: link.delivered });
  } catch (error) {
    if (error instanceof Error && error.message === "paused") return jsonError(c, 422, "paused", "השליחה כבויה בהגדרות");
    throw error;
  }
});

async function rememberLink(contactId: string, actor: string, kind: LinkKind, what: string) {
  await addTimeline(contactId, "field_change", actor, { changes: [{ field: linkLabel(kind), to: what }] });
}

async function removeMatchingVisitNotes(contactId: string, appointmentId: string, text: string | null) {
  const trimmed = text?.trim();
  if (!trimmed) return;
  const appointment = await prisma.appointment.findFirst({ where: { id: appointmentId, contactId } });
  if (appointment?.notes?.trim() === trimmed) {
    await prisma.appointment.update({ where: { id: appointment.id }, data: { notes: null } });
  }
  const events = await prisma.timelineEvent.findMany({ where: { contactId, type: "note" } });
  const ids = events
    .filter((item) => {
      const payload = item.payload as { appointmentId?: string; text?: string };
      return payload.appointmentId === appointmentId && payload.text?.trim() === trimmed;
    })
    .map((item) => item.id);
  if (ids.length) await prisma.timelineEvent.deleteMany({ where: { id: { in: ids } } });
}

contactRoutes.patch("/:id/notes/:noteId", async (c) => {
  const contactId = c.req.param("id");
  const noteId = c.req.param("noteId");
  const body = z.object({ text: z.string() }).parse(await c.req.json());
  const text = body.text.trim();
  if (!text) return jsonError(c, 422, "missing", "ההערה ריקה");
  if (noteId.startsWith("visit-")) {
    const appointmentId = noteId.slice("visit-".length);
    const appointment = await prisma.appointment.findFirst({ where: { id: appointmentId, contactId } });
    if (!appointment) return jsonError(c, 404, "not_found", "ההערה לא נמצאה");
    const previous = appointment.notes?.trim() ?? "";
    await replaceVisitNote(contactId, appointment.id, appointment.notes, text);
    if (previous !== text) await addTimeline(contactId, "field_change", currentUser(c).username, { changes: [{ field: "הערה", from: previous, to: text }] });
    return c.json({ ok: true });
  }
  const event = await prisma.timelineEvent.findFirst({ where: { id: noteId, contactId, type: "note" } });
  if (!event) return jsonError(c, 404, "not_found", "ההערה לא נמצאה");
  const payload = event.payload as { appointmentId?: string; text?: string };
  const previous = payload.text?.trim() ?? "";
  await prisma.timelineEvent.update({ where: { id: event.id }, data: { payload: { ...payload, text } } });
  if (payload.appointmentId) await replaceVisitNote(contactId, payload.appointmentId, payload.text ?? null, text);
  if (previous !== text) await addTimeline(contactId, "field_change", currentUser(c).username, { changes: [{ field: "הערה", from: previous, to: text }] });
  return c.json({ ok: true });
});

async function replaceVisitNote(contactId: string, appointmentId: string, from: string | null, text: string) {
  const previous = from?.trim();
  const appointment = await prisma.appointment.findFirst({ where: { id: appointmentId, contactId } });
  if (appointment && (!previous || appointment.notes?.trim() === previous)) {
    await prisma.appointment.update({ where: { id: appointment.id }, data: { notes: text } });
  }
  if (!previous) return;
  const events = await prisma.timelineEvent.findMany({ where: { contactId, type: "note" } });
  for (const item of events) {
    const payload = item.payload as { appointmentId?: string; text?: string };
    if (payload.appointmentId === appointmentId && payload.text?.trim() === previous) {
      await prisma.timelineEvent.update({ where: { id: item.id }, data: { payload: { ...payload, text } } });
    }
  }
}

contactRoutes.delete("/:id/notes/:noteId", async (c) => {
  const contactId = c.req.param("id");
  const noteId = c.req.param("noteId");
  if (noteId.startsWith("visit-")) {
    const appointmentId = noteId.slice("visit-".length);
    const appointment = await prisma.appointment.findFirst({ where: { id: appointmentId, contactId } });
    if (!appointment) return jsonError(c, 404, "not_found", "ההערה לא נמצאה");
    await removeMatchingVisitNotes(contactId, appointment.id, appointment.notes);
    if (appointment.notes?.trim()) await addTimeline(contactId, "field_change", currentUser(c).username, { changes: [{ field: "הערה", from: appointment.notes.trim(), to: "" }] });
    return c.json({ ok: true });
  }
  const event = await prisma.timelineEvent.findFirst({ where: { id: noteId, contactId, type: "note" } });
  if (!event) return jsonError(c, 404, "not_found", "ההערה לא נמצאה");
  const payload = event.payload as { appointmentId?: string; text?: string };
  await prisma.timelineEvent.delete({ where: { id: event.id } });
  if (payload.appointmentId) await removeMatchingVisitNotes(contactId, payload.appointmentId, payload.text ?? null);
  if (payload.text?.trim()) await addTimeline(contactId, "field_change", currentUser(c).username, { changes: [{ field: "הערה", from: payload.text.trim(), to: "" }] });
  return c.json({ ok: true });
});

contactRoutes.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const appointments = await prisma.appointment.findMany({ where: { contactId: id }, select: { id: true } });
  await prisma.creditRedemption.deleteMany({
    where: { OR: [{ appointmentId: { in: appointments.map((item) => item.id) } }, { credit: { contactId: id } }] },
  });
  await prisma.referral.deleteMany({ where: { OR: [{ referrerId: id }, { referredId: id }] } });
  await prisma.contact.updateMany({ where: { referredById: id }, data: { referredById: null } });
  await prisma.contact.delete({ where: { id } });
  return c.json({ ok: true, by: currentUser(c).username });
});
