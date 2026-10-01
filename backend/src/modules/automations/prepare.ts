import { prisma } from "@noa/db";
import { DISCOUNT_PERCENT, MESSAGE_DEFAULTS, priceAfterPercent } from "@noa/shared";
import { clock, hebrewDate } from "../../lib/time.js";
import { ensureLink } from "../links/service.js";
import { pushFacts } from "./service.js";

type Payload = { appointmentId?: string; serviceId?: string };

type Prepared = {
  skip?: boolean;
  vars?: Record<string, string>;
  facts?: Record<string, string>;
  template?: string;
  linkId?: string;
};

export async function prepareJob(key: string, contactId: string, payload: Payload, template: string): Promise<Prepared> {
  if (key === "beshvilech") return prepareQuestionnaire(contactId, payload, template);
  if (key === "discount") return prepareDiscount(contactId, payload, template);
  if (key === "no_show") return prepareNoShow(payload, template);
  if (key === "became_regular" || key === "partner_link") return preparePartner(key, contactId, template);
  if (key === "no_answer_3") return { vars: {}, facts: pushFacts("שלוש שיחות בלי מענה. זו ההודעה האחרונה, והיא מזמינה את הלקוחה לכתוב כשמתאים לה."), template };
  return { vars: {}, facts: pushFacts("נשלחה הודעה ללקוחה מהמערכת."), template };
}

async function prepareQuestionnaire(contactId: string, payload: Payload, template: string): Promise<Prepared> {
  if (!payload.serviceId) return { skip: true };
  if (payload.appointmentId) {
    const linked = await prisma.appointment.findUnique({ where: { id: payload.appointmentId }, include: { service: true } });
    if (!linked || linked.status === "בוטל") {
      const other = await prisma.appointment.findFirst({
        where: { contactId, serviceId: payload.serviceId, status: "נקבע", startsAt: { gt: new Date() } },
      });
      if (!other) return { skip: true };
    }
  }
  const filled = await prisma.questionnaireResponse.findUnique({
    where: { contactId_serviceId: { contactId, serviceId: payload.serviceId } },
  });
  if (filled) return { skip: true };
  const link = await ensureLink(contactId, "questionnaire");
  const service = payload.appointmentId
    ? (await prisma.appointment.findUnique({ where: { id: payload.appointmentId }, include: { service: true } }))?.service.name
    : "לק ג'ל";
  const serviceName = service || "לק ג'ל";
  return {
    template,
    vars: { קישור: link.url },
    linkId: link.id,
    facts: pushFacts(
      `קישור לשאלון בשבילך, לפני תור ${serviceName}. זה דף קצר שהלקוחה ממלאה עם נועה, כדי להתאים לה את החומרים לפני שמתחילים.`,
      { [`קישור לשאלון בשבילך, לפני תור ${serviceName}`]: link.url },
    ),
  };
}

async function prepareDiscount(contactId: string, payload: Payload, template: string): Promise<Prepared> {
  if (!payload.serviceId) return { skip: true };
  const service = await prisma.service.findUnique({ where: { id: payload.serviceId } });
  if (!service) return { skip: true };
  const future = await prisma.appointment.count({
    where: { contactId, status: "נקבע", startsAt: { gt: new Date() }, ...(payload.appointmentId ? { id: { not: payload.appointmentId } } : {}) },
  });
  const link = await ensureLink(contactId, "discount_booking");
  const after = priceAfterPercent(service.price, DISCOUNT_PERCENT);
  const until = link.expiresAt ? `${hebrewDate(link.expiresAt)} בשעה ${clock(link.expiresAt)}` : "24 שעות מרגע יצירת הקישור";
  const what = future > 0
    ? `קישור להנחה של ${DISCOUNT_PERCENT}% על תור ${service.name} שכבר קבוע. ההנחה בתוקף עד ${until}, ואז היא נסגרת.`
    : `קישור להנחה של ${DISCOUNT_PERCENT}% על התור הבא של ${service.name}. ההנחה בתוקף עד ${until}, ואז היא נסגרת. הקישור פותח שעות פנויות, וההנחה כבר על המחיר.`;
  return {
    template: future > 0 ? MESSAGE_DEFAULTS.discountExisting : template,
    vars: { קישור: link.url, מחיר: String(service.price), מחיר_אחרי: String(after) },
    linkId: link.id,
    facts: pushFacts(what, {
      שירות: service.name,
      "מחיר רגיל": `${service.price}₪`,
      [`מחיר אחרי ${DISCOUNT_PERCENT}% הנחה`]: `${after}₪`,
      "ההנחה בתוקף עד": until,
      "קישור להנחה ולקביעת התור": link.url,
    }),
  };
}

async function prepareNoShow(payload: Payload, template: string): Promise<Prepared> {
  if (!payload.appointmentId) return { skip: true };
  const appointment = await prisma.appointment.findUnique({ where: { id: payload.appointmentId }, include: { service: true } });
  if (!appointment || (appointment.status !== "נקבע" && appointment.status !== "לא הגיעה")) return { skip: true };
  const when = `${hebrewDate(appointment.startsAt)} בשעה ${clock(appointment.startsAt)}`;
  return {
    template,
    vars: { תאריך: hebrewDate(appointment.startsAt) },
    facts: pushFacts(
      `הלקוחה לא הגיעה לתור של ${appointment.service.name}, ${when}. נשלחה לה הצעה לקבוע מחדש.`,
      { שירות: appointment.service.name, "מתי היה התור": when },
    ),
  };
}

async function preparePartner(key: string, contactId: string, template: string): Promise<Prepared> {
  const link = await ensureLink(contactId, "referral");
  const becameRegular = key === "became_regular";
  return {
    template,
    vars: { קישור: link.url },
    linkId: link.id,
    facts: pushFacts(
      becameRegular
        ? "הלקוחה הפכה לקבועה. נשלח לה קישור שותפים: חברה שמגיעה דרכו מקבלת 10% בביקור הראשון, והלקוחה מקבלת 10% לשלושה חודשים אחרי שהחברה מגיעה."
        : "קישור השותפים של הלקוחה. זה הדף שלה אצל נועה, עם כפתור ששולח לחברה הזמנה לוואטסאפ. החברה מקבלת 10% על התור הראשון, ואחרי שהחברה מגיעה הלקוחה מקבלת 10% ל־3 חודשים.",
      { "קישור השותפים, הדף שהיא שולחת לחברה": link.url },
    ),
  };
}
