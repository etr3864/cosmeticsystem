import { prisma } from "@noa/db";
import { DISCOUNT_HOURS, DISCOUNT_PERCENT, MESSAGE_DEFAULTS, priceAfterPercent } from "@noa/shared";
import { randomToken, sha256 } from "../../lib/crypto.js";
import { deliverMessage } from "../automations/service.js";

const frontend = () => process.env.FRONTEND_URL ?? "http://localhost:3000";

export const linkKinds = ["questionnaire", "discount_booking", "referral"] as const;
export type LinkKind = (typeof linkKinds)[number];

const copy = {
  questionnaire: { label: "שאלון בשבילך", detail: "למילוי יחד בלק ג'ל." },
  discount_booking: { label: "הנחה לתיאום", detail: "24 שעות מרגע היצירה. שליחה לא מאריכה את הזמן." },
  referral: { label: "קישור לחברה", detail: "הדף שהיא שולחת לחברה. נשאר פתוח עד ביטול." },
} as const;

export function isLinkKind(value: string): value is LinkKind {
  return (linkKinds as readonly string[]).includes(value);
}

export function linkLabel(kind: LinkKind) {
  return copy[kind].label;
}

function linkUrl(kind: string, token: string) {
  const path = kind === "referral" ? "partners" : kind === "questionnaire" ? "for-you" : "book";
  return `${frontend()}/${path}/${token}`;
}

function expiryFor(kind: LinkKind) {
  if (kind !== "discount_booking") return undefined;
  return new Date(Date.now() + DISCOUNT_HOURS * 3600_000);
}

function expired(expiresAt: Date | null) {
  return Boolean(expiresAt && expiresAt.getTime() < Date.now());
}

export async function issueLink(contactId: string, kind: string, expiresAt?: Date) {
  const token = randomToken();
  await prisma.publicLink.updateMany({ where: { contactId, kind, active: true }, data: { active: false } });
  const row = await prisma.publicLink.create({
    data: { contactId, kind, tokenHash: sha256(token), tokenHint: token.slice(-6), token, expiresAt, active: true },
  });
  return { id: row.id, url: linkUrl(kind, token), createdAt: row.createdAt, expiresAt: row.expiresAt, sentAt: row.sentAt };
}

async function liveLink(contactId: string, kind: LinkKind) {
  const link = await prisma.publicLink.findFirst({
    where: { contactId, kind, active: true, token: { not: null } },
    orderBy: { createdAt: "desc" },
  });
  if (!link?.token || expired(link.expiresAt)) return null;
  return link;
}

export async function ensureLink(contactId: string, kind: LinkKind) {
  const current = await liveLink(contactId, kind);
  if (current?.token) {
    return { id: current.id, url: linkUrl(kind, current.token), createdAt: current.createdAt, expiresAt: current.expiresAt, sentAt: current.sentAt, fresh: false };
  }
  const created = await issueLink(contactId, kind, expiryFor(kind));
  return { ...created, fresh: true };
}

export async function markLinkSent(id: string) {
  const row = await prisma.publicLink.update({ where: { id }, data: { sentAt: new Date() } });
  return row.sentAt;
}

export async function listLinks(contactId: string) {
  const rows = await prisma.publicLink.findMany({
    where: { contactId, active: true },
    orderBy: { createdAt: "desc" },
  });
  return linkKinds.map((kind) => {
    const row = rows.find((item) => item.kind === kind);
    const dead = !row?.token || expired(row.expiresAt);
    return {
      id: dead ? null : row.id,
      kind,
      label: copy[kind].label,
      detail: copy[kind].detail,
      url: dead || !row?.token ? null : linkUrl(kind, row.token),
      createdAt: dead ? null : row.createdAt,
      sentAt: dead ? null : row.sentAt,
      expiresAt: dead ? null : row.expiresAt,
      live: !dead,
    };
  });
}

async function questionnaireFilled(contactId: string) {
  const nails = await prisma.service.findUnique({ where: { code: "NAILS" } });
  if (!nails) return false;
  const filled = await prisma.questionnaireResponse.findUnique({
    where: { contactId_serviceId: { contactId, serviceId: nails.id } },
  });
  return Boolean(filled);
}

export async function createContactLink(contactId: string, kind: LinkKind, replace: boolean) {
  if (kind === "questionnaire" && await questionnaireFilled(contactId)) {
    const error = new Error("filled");
    throw error;
  }
  const current = await liveLink(contactId, kind);
  if (current?.token && !replace) {
    return { id: current.id, url: linkUrl(kind, current.token), createdAt: current.createdAt, expiresAt: current.expiresAt, sentAt: current.sentAt, fresh: false };
  }
  const created = await issueLink(contactId, kind, expiryFor(kind));
  return { ...created, fresh: true };
}

async function messageFor(contactId: string, kind: LinkKind, url: string) {
  const vars: Record<string, string> = { קישור: url };
  if (kind === "questionnaire") {
    const automation = await prisma.automation.findUnique({ where: { key: "beshvilech" } });
    return { template: automation?.messageTemplate || MESSAGE_DEFAULTS.beshvilech, vars };
  }
  if (kind === "referral") {
    const automation = await prisma.automation.findUnique({ where: { key: "partner_link" } });
    return { template: automation?.messageTemplate || MESSAGE_DEFAULTS.partnerLink, vars };
  }
  const service = await prisma.service.findUnique({ where: { code: "NAILS" } });
  const price = service?.price ?? 120;
  vars["מחיר"] = String(price);
  vars["מחיר_אחרי"] = String(priceAfterPercent(price, DISCOUNT_PERCENT));
  const future = await prisma.appointment.count({ where: { contactId, status: "נקבע", startsAt: { gt: new Date() } } });
  const automation = await prisma.automation.findUnique({ where: { key: "discount" } });
  const template = future > 0 ? MESSAGE_DEFAULTS.discountExisting : (automation?.messageTemplate || MESSAGE_DEFAULTS.discount);
  return { template, vars };
}

export async function sendContactLink(contactId: string, kind: LinkKind) {
  if (kind === "questionnaire" && await questionnaireFilled(contactId)) throw new Error("filled");
  const link = await ensureLink(contactId, kind);
  const message = await messageFor(contactId, kind, link.url);
  const sent = await deliverMessage(contactId, message.template, message.vars);
  const sentAt = sent.delivered ? await markLinkSent(link.id) : link.sentAt;
  return { ...link, sentAt, delivered: sent.delivered };
}

export async function revokeLink(contactId: string, linkId: string) {
  const link = await prisma.publicLink.findFirst({ where: { id: linkId, contactId, active: true } });
  if (!link) return null;
  await prisma.publicLink.update({ where: { id: link.id }, data: { active: false } });
  return link.kind;
}

export async function findLink(token: string) {
  const link = await prisma.publicLink.findUnique({
    where: { tokenHash: sha256(token) },
    include: { contact: true },
  });
  if (!link || !link.active) return null;
  if (link.expiresAt && link.expiresAt.getTime() < Date.now()) return { ...link, expired: true as const };
  return { ...link, expired: false as const };
}
