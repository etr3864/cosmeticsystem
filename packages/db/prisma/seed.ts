import argon2 from "argon2";
import { MESSAGE_DEFAULTS, CLINIC_ADDRESS, CLINIC_PARKING, CLINIC_UNIT, AGENT_ID_DEFAULT } from "@noa/shared";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const nailsQuestions = [
  { id: "allergy", label: "יש לך אלרגיות או רגישויות?", type: "choice", required: true, options: ["לא, אין לי רגישות ידועה", "כן, יש לי רגישות", "לא בטוחה"], detail: "למה? (לא חובה)" },
  { id: "last", label: "מתי עשית לק ג'ל בפעם האחרונה?", type: "text", required: true },
  { id: "hold", label: "כמה זמן החזיק הלק בפעם האחרונה?", type: "text", required: true },
  { id: "less", label: "היו דברים שפחות אהבת בטיפולים קודמים?", type: "text", required: false },
  { id: "style", label: "איזה סגנון את אוהבת?", type: "text", required: false },
  { id: "event", label: "יש לך אירוע קרוב שכדאי לדעת עליו לקראת התור?", type: "text", required: false },
];

async function main() {
  const eitanPassword = process.env.SEED_EITAN_PASSWORD ?? "eitan-dev";
  const noaPassword = process.env.SEED_NOA_PASSWORD ?? "noa-dev";

  await prisma.user.upsert({
    where: { username: "eitan" },
    update: {},
    create: { username: "eitan", role: "super_admin", passwordHash: await argon2.hash(eitanPassword), phone: null },
  });
  await prisma.user.upsert({
    where: { username: "noa" },
    update: {},
    create: { username: "noa", role: "owner", passwordHash: await argon2.hash(noaPassword), phone: null },
  });

  const nails = await prisma.service.upsert({
    where: { code: "NAILS" },
    update: {},
    create: { code: "NAILS", name: "לק ג'ל", durationMin: 70, bufferMin: 10, price: 120, hasForYou: true },
  });
  await prisma.service.upsert({
    where: { code: "FACE" },
    update: {},
    create: { code: "FACE", name: "טיפולי פנים", durationMin: 60, bufferMin: 10, price: 120, hasForYou: false },
  });

  await prisma.questionnaire.upsert({
    where: { serviceId: nails.id },
    update: {},
    create: { serviceId: nails.id, title: "בשבילך", questions: nailsQuestions },
  });

  const automations = [
    { key: "beshvilech", triggerEvent: "appointment.booked", delayMinutes: -20, messageTemplate: MESSAGE_DEFAULTS.beshvilech, oncePerContact: true },
    { key: "discount", triggerEvent: "appointment.attended", delayMinutes: 0, messageTemplate: MESSAGE_DEFAULTS.discount, oncePerContact: false },
    { key: "no_show", triggerEvent: "appointment.ended_unmarked", delayMinutes: 120, messageTemplate: MESSAGE_DEFAULTS.noShow, oncePerContact: false },
    { key: "no_answer_3", triggerEvent: "contact.status_changed", delayMinutes: 0, messageTemplate: MESSAGE_DEFAULTS.noAnswer3, oncePerContact: false },
    { key: "became_regular", triggerEvent: "contact.status_changed", delayMinutes: 0, messageTemplate: MESSAGE_DEFAULTS.becameRegular, oncePerContact: true },
    { key: "partner_link", triggerEvent: "manual.send", delayMinutes: 0, messageTemplate: MESSAGE_DEFAULTS.partnerLink, oncePerContact: false },
  ];
  for (const item of automations) {
    await prisma.automation.upsert({ where: { key: item.key }, update: {}, create: item });
  }

  const settings: Record<string, unknown> = {
    markedWeek: {},
    stepMin: 30,
    leadMin: 180,
    horizonDays: 10,
    sendWindow: { days: [0, 1, 2, 3, 4], start: "08:00", end: "20:00" },
    clinic: { address: CLINIC_ADDRESS, unit: CLINIC_UNIT, parking: CLINIC_PARKING },
    optiveAgentId: AGENT_ID_DEFAULT,
    riskJobEnabled: false,
    pageSize: 25,
  };
  for (const [key, value] of Object.entries(settings)) {
    await prisma.setting.upsert({ where: { key }, update: {}, create: { key, value: value as object } });
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
