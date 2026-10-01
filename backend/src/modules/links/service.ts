import { prisma } from "@noa/db";
import { DISCOUNT_HOURS, DISCOUNT_PERCENT, MESSAGE_DEFAULTS, priceAfterPercent } from "@noa/shared";
import { decrypt, encrypt, randomToken, sha256 } from "../../lib/crypto.js";
import { deliverMessage, pushFacts } from "../automations/service.js";
import { clock, hebrewDate } from "../../lib/time.js";

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

function sealToken(token: string) {
  return encrypt(token);
}

function openToken(stored: string) {
  if (/^[0-9a-f]{64}$/i.test(stored)) return { plain: stored, legacy: true };
  return { plain: decrypt(stored), legacy: false };
}

export async function revealToken(row: { id: string; token: string }) {
  const opened = openToken(row.token);
  if (opened.legacy) await prisma.publicLink.update({ where: { id: row.id }, data: { token: sealToken(opened.plain) } });
  return opened.plain;
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
    data: { contactId, kind, tokenHash: sha256(token), tokenHint: token.slice(-6), token: sealToken(token), expiresAt, active: true },
  });
  return { id: row.id, url: linkUrl(kind, token), createdAt: row.createdAt, expiresAt: row.expiresAt, sentAt: row.sentAt };
}

async function liveLink(contactId: string, kind: LinkKind) {
  const link = await prisma.publicLink.findFirst({
    where: { contactId, kind, active: true, token: { not: null } },
    orderBy: { createdAt: "desc" },
  });
  if (!link?.token || expired(link.expiresAt)) return null;
  return { ...link, token: await revealToken({ id: link.id, token: link.token }) };
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
  return Promise.all(linkKinds.map(async (kind) => {
    const row = rows.find((item) => item.kind === kind);
    const dead = !row?.token || expired(row.expiresAt);
    const token = !dead && row?.token ? await revealToken({ id: row.id, token: row.token }) : null;
    return {
      id: dead ? null : row.id,
      kind,
      label: copy[kind].label,
      detail: copy[kind].detail,
      url: token ? linkUrl(kind, token) : null,
      createdAt: dead ? null : row.createdAt,
      sentAt: dead ? null : row.sentAt,
      expiresAt: dead ? null : row.expiresAt,
      live: !dead,
    };
  }));
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

async function messageFor(contactId: string, kind: LinkKind, url: string, expiresAt: Date | null) {
  const vars: Record<string, string> = { קישור: url };
  if (kind === "questionnaire") {
    const automation = await prisma.automation.findUnique({ where: { key: "beshvilech" } });
    return {
      template: automation?.messageTemplate || MESSAGE_DEFAULTS.beshvilech,
      vars,
      facts: pushFacts(
        "קישור לשאלון בשבילך, לפני תור לק ג'ל. זה דף קצר שהלקוחה ממלאה עם נועה, כדי להתאים לה את החומרים לפני שמתחילים.",
        { "קישור לשאלון בשבילך, לפני תור לק ג'ל": url },
      ),
    };
  }
  if (kind === "referral") {
    const automation = await prisma.automation.findUnique({ where: { key: "partner_link" } });
    return {
      template: automation?.messageTemplate || MESSAGE_DEFAULTS.partnerLink,
      vars,
      facts: pushFacts(
        "קישור השותפים של הלקוחה. זה הדף שלה אצל נועה, עם כפתור ששולח לחברה הזמנה לוואטסאפ. החברה מקבלת 10% על התור הראשון, ואחרי שהחברה מגיעה הלקוחה מקבלת 10% ל־3 חודשים.",
        { "קישור השותפים, הדף שהיא שולחת לחברה": url },
      ),
    };
  }
  const service = await prisma.service.findUnique({ where: { code: "NAILS" } });
  const price = service?.price ?? 120;
  const after = priceAfterPercent(price, DISCOUNT_PERCENT);
  vars["מחיר"] = String(price);
  vars["מחיר_אחרי"] = String(after);
  const future = await prisma.appointment.count({ where: { contactId, status: "נקבע", startsAt: { gt: new Date() } } });
  const automation = await prisma.automation.findUnique({ where: { key: "discount" } });
  const template = future > 0 ? MESSAGE_DEFAULTS.discountExisting : (automation?.messageTemplate || MESSAGE_DEFAULTS.discount);
  const until = expiresAt ? `${hebrewDate(expiresAt)} בשעה ${clock(expiresAt)}` : "24 שעות מרגע יצירת הקישור";
  const serviceName = service?.name ?? "לק ג'ל";
  const what = future > 0
    ? `קישור להנחה של ${DISCOUNT_PERCENT}% על תור ${serviceName} שכבר קבוע. ההנחה בתוקף עד ${until}, ואז היא נסגרת.`
    : `קישור להנחה של ${DISCOUNT_PERCENT}% על התור הבא של ${serviceName}. ההנחה בתוקף עד ${until}, ואז היא נסגרת. הקישור פותח שעות פנויות, וההנחה כבר על המחיר.`;
  return {
    template,
    vars,
    facts: pushFacts(what, {
      שירות: serviceName,
      "מחיר רגיל": `${price}₪`,
      [`מחיר אחרי ${DISCOUNT_PERCENT}% הנחה`]: `${after}₪`,
      "ההנחה בתוקף עד": until,
      "קישור להנחה ולקביעת התור": url,
    }),
  };
}

const sendKey: Record<LinkKind, string> = {
  questionnaire: "beshvilech",
  referral: "partner_link",
  discount_booking: "discount",
};

export async function sendContactLink(contactId: string, kind: LinkKind) {
  if (kind === "questionnaire" && await questionnaireFilled(contactId)) throw new Error("filled");
  const automation = await prisma.automation.findUnique({ where: { key: sendKey[kind] } });
  if (automation && !automation.active) throw new Error("paused");
  const link = await ensureLink(contactId, kind);
  const message = await messageFor(contactId, kind, link.url, link.expiresAt);
  const sent = await deliverMessage(contactId, message.template, message.vars, message.facts);
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
