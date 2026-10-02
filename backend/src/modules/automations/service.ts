import { prisma } from "@noa/db";
import { firstName, renderTemplate, withFirstName, toOptivePhone } from "@noa/shared";
import { decrypt } from "../../lib/crypto.js";
import { logEvent } from "../../lib/log.js";
import { addTimeline } from "../pipelines/service.js";

export async function enqueueAutomation(input: {
  key: string;
  contactId: string;
  runAt: Date;
  idempotencyKey: string;
  payload: object;
}) {
  const automation = await prisma.automation.findUnique({ where: { key: input.key } });
  if (!automation?.active) return false;
  if (automation.oncePerContact) {
    const prior = await prisma.scheduledJob.findFirst({
      where: { automationId: automation.id, contactId: input.contactId, status: { in: ["pending", "sent", "running"] } },
    });
    if (prior) return false;
  }
  await prisma.scheduledJob.upsert({
    where: { idempotencyKey: input.idempotencyKey },
    update: {},
    create: {
      automationId: automation.id,
      contactId: input.contactId,
      runAt: input.runAt,
      idempotencyKey: input.idempotencyKey,
      payload: input.payload,
    },
  });
  return true;
}

export function pushFacts(what: string, details: Record<string, string> = {}) {
  const labeled = Object.fromEntries(Object.entries(details).filter(([, value]) => value.trim()));
  return { "מה זה": what, ...labeled };
}

async function pushOptive(contactId: string, facts: Record<string, string>, message?: string) {
  const contact = await prisma.contact.findUnique({ where: { id: contactId } });
  if (!contact) return { ok: false, name: "" };
  const data = { לקוחה: contact.name, ...facts };
  const secret = await prisma.secret.findUnique({ where: { key: "optive_api_key" } });
  if (!secret) return { ok: false, name: contact.name };
  const response = await fetch("https://api.0ptive.com/api/external/triggers/push", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": decrypt(secret.ciphertext) },
    body: JSON.stringify({ phone: toOptivePhone(contact.phone), persist: true, data, ...(message ? { message } : {}) }),
  });
  return { ok: response.ok, status: response.status, name: contact.name };
}

export async function rememberFacts(contactId: string, facts: Record<string, string>) {
  try {
    const saved = await pushOptive(contactId, facts);
    if (!saved.name) return;
    if (!saved.ok) await logEvent("automation", "warn", saved.status ? "שירה לא עודכנה" : "אין מפתח, שירה לא עודכנה", { contactId, status: saved.status });
  } catch (error) {
    await logEvent("automation", "error", "שירה לא עודכנה", { contactId, error: error instanceof Error ? error.message : "failed" }).catch(() => undefined);
  }
}

export async function deliverMessage(contactId: string, template: string, vars: Record<string, string>, facts: Record<string, string>) {
  const contact = await prisma.contact.findUniqueOrThrow({ where: { id: contactId } });
  const message = withFirstName(template, firstName(contact.name), vars);
  const secret = await prisma.secret.findUnique({ where: { key: "optive_api_key" } });
  if (!secret) {
    await logEvent("automation", "warn", "אין מפתח לשליחה, ההודעה נשמרה במערכת", { contactId });
    await addTimeline(contactId, "automation_sent", "automation", { message, delivered: false });
    return { delivered: false, message };
  }
  const saved = await pushOptive(contactId, facts, message);
  const delivered = saved.ok;
  if (!delivered) await logEvent("automation", "error", "השליחה נכשלה", { status: saved.status, contactId });
  await addTimeline(contactId, "automation_sent", "automation", { message, delivered });
  return { delivered, message };
}

export function fillTemplate(template: string, vars: Record<string, string>, name: string) {
  return renderTemplate(withFirstName(template, firstName(name), vars), vars);
}
