import { prisma } from "@noa/db";
import { formatPhoneDisplay, toOptivePhone } from "@noa/shared";

const now = () => new Date();

export function loadContact(phone: string) {
  const moment = now();
  return prisma.contact.findUnique({
    where: { phone },
    include: {
      services: { include: { service: true }, orderBy: { service: { name: "asc" } } },
      appointments: {
        where: { startsAt: { gt: moment }, status: "נקבע" },
        orderBy: { startsAt: "asc" },
        take: 3,
        include: { service: true },
      },
      credits: {
        where: { expiresAt: { gt: moment }, remainingPct: { gt: 0 } },
        orderBy: { expiresAt: "asc" },
      },
    },
  });
}

type Loaded = NonNullable<Awaited<ReturnType<typeof loadContact>>>;

export function presentContact(contact: Loaded) {
  return {
    id: contact.id,
    name: contact.name,
    phone: contact.phone,
    phoneOptive: toOptivePhone(contact.phone),
    phoneDisplay: formatPhoneDisplay(contact.phone),
    source: contact.source,
    sourceDetail: contact.sourceDetail,
    salesStatus: contact.salesStatus,
    notRelevantReason: contact.notRelevantReason,
    lastAiSummary: contact.lastAiSummary,
    noShowCount: contact.noShowCount,
    createdAt: contact.createdAt,
    services: contact.services.map((row) => ({
      code: row.service.code,
      name: row.service.name,
      opsStatus: row.opsStatus,
      leftReason: row.leftReason,
      firstVisitAt: row.firstVisitAt,
      lastVisitAt: row.lastVisitAt,
    })),
    upcomingAppointments: contact.appointments.map((row) => ({
      id: row.id,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      status: row.status,
      serviceCode: row.service.code,
      serviceName: row.service.name,
      finalPrice: row.finalPrice,
    })),
    credits: contact.credits.map((row) => ({
      percent: row.percent,
      remainingPct: row.remainingPct,
      expiresAt: row.expiresAt,
    })),
  };
}
