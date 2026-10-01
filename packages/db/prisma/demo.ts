import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function at(offsetDays: number, hour: number, minute = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  date.setHours(hour, minute, 0, 0);
  return date;
}

function until(start: Date, minutes: number) {
  return new Date(start.getTime() + minutes * 60_000);
}

function e164(local: string) {
  return `+972${local.replace(/\D/g, "").replace(/^0/, "")}`;
}

async function clearDemo() {
  const old = await prisma.contact.findMany({ where: { sourceDetail: "demo" }, select: { id: true } });
  const ids = old.map((item) => item.id);
  if (ids.length) {
    await prisma.creditRedemption.deleteMany({ where: { OR: [{ credit: { contactId: { in: ids } } }, { appointment: { contactId: { in: ids } } }] } });
    await prisma.referral.deleteMany({ where: { OR: [{ referrerId: { in: ids } }, { referredId: { in: ids } }] } });
    await prisma.contact.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.calendarReview.deleteMany({ where: { googleEventId: { startsWith: "demo-" } } });
}

async function main() {
  await clearDemo();
  const stale = await prisma.campaign.findMany({ where: { name: { startsWith: "קמפיין " }, contacts: { none: {} } }, select: { id: true } });
  if (stale.length) {
    await prisma.campaignSpend.deleteMany({ where: { campaignId: { in: stale.map((item) => item.id) } } });
    await prisma.campaign.deleteMany({ where: { id: { in: stale.map((item) => item.id) } } });
  }
  const nails = await prisma.service.findUniqueOrThrow({ where: { code: "NAILS" } });
  const face = await prisma.service.findUniqueOrThrow({ where: { code: "FACE" } });
  const month = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
  const campaign = await prisma.campaign.create({ data: { name: `קמפיין ${month}`, prefillText: "" } });
  await prisma.campaignSpend.create({ data: { campaignId: campaign.id, month, amount: 2400 } });

  await prisma.setting.upsert({
    where: { key: "markedWeek" },
    update: { value: { 0: { start: "09:00", end: "19:00" }, 1: { start: "09:00", end: "19:00" }, 2: { start: "09:00", end: "19:00" }, 3: { start: "09:00", end: "19:00" }, 4: { start: "09:00", end: "19:00" }, 5: null, 6: null } },
    create: { key: "markedWeek", value: {} },
  });

  const clients = [
    ["מיכל אברהם", "052-700-1001", -120],
    ["יעל כהן", "052-700-1002", -90],
    ["הילה לוי", "052-700-1003", -20],
    ["מאיה פרץ", "052-700-1004", -80],
    ["רונית ביטון", "052-700-1005", -100],
    ["שירן דהן", "052-700-1006", -70],
    ["ליאת אוחיון", "052-700-1007", -60],
    ["עדן מזרחי", "052-700-1008", -15],
    ["תמר אלקיים", "052-700-1009", -40],
    ["אורטל חדד", "052-700-1010", -50],
  ] as const;

  const made: Record<string, string> = {};
  for (const [name, phone, days] of clients) {
    const contact = await prisma.contact.create({
      data: { name, phone: e164(phone), source: "פנייה ישירה לנועה", sourceDetail: "demo", salesStatus: "לקוחה פעילה", createdAt: at(days, 11) },
    });
    made[name] = contact.id;
  }

  const leads = [
    ["רותם גבאי", "052-700-1101", "ליד חדש", "מודעה ממומנת"],
    ["ספיר אזולאי", "052-700-1102", "אין מענה 1", "מודעה ממומנת"],
    ["הדר נחום", "052-700-1103", "אין מענה 2", "אינסטגרם אורגני"],
    ["מעיין שמש", "052-700-1104", "אין מענה 3", "מודעה ממומנת"],
    ["לין אבו", "052-700-1105", "נקבע תור אנושי", "פנייה ישירה לנועה"],
    ["יסמין כהן", "052-700-1106", "לא רלוונטית", "אחר"],
    ["אביגיל מור", "052-700-1107", "ליד חדש", "המלצה מלקוחה"],
    ["דנה ברק", "052-700-1108", "אין מענה 1", "קבוצת וואטסאפ"],
  ] as const;
  for (const [name, phone, status, source] of leads) {
    const contact = await prisma.contact.create({
      data: {
        name,
        phone: e164(phone),
        source,
        sourceDetail: "demo",
        salesStatus: status,
        campaignId: source === "מודעה ממומנת" ? campaign.id : null,
        referredById: source === "המלצה מלקוחה" ? made["מיכל אברהם"] : null,
        notRelevantReason: status === "לא רלוונטית" ? "לא מחפשת תור כרגע" : null,
        createdAt: at(0, 8),
      },
    });
    made[name] = contact.id;
  }
  await prisma.referral.create({ data: { referrerId: made["מיכל אברהם"], referredId: made["אביגיל מור"], via: "link" } });

  async function visit(name: string, serviceId: string, start: Date, status: string, price: number, minutes: number, notes?: string, mother = false) {
    const appointment = await prisma.appointment.create({
      data: {
        contactId: made[name],
        serviceId,
        startsAt: start,
        endsAt: until(start, minutes),
        status,
        bookedBy: "נועה",
        listPrice: 120,
        finalPrice: price,
        amountPaid: status === "הגיעה" ? price : null,
        paymentMethod: status === "הגיעה" ? "ביט" : null,
        notes,
        motherDaughter: mother,
      },
    });
    return appointment;
  }

  await visit("מיכל אברהם", nails.id, at(-70, 10), "הגיעה", 120, 70, "לק שקדי");
  await visit("מיכל אברהם", nails.id, at(-40, 10), "הגיעה", 120, 70);
  await visit("מיכל אברהם", nails.id, at(0, 9), "הגיעה", 108, 70, "חיזוק ומעבר לניוד", true);
  await visit("יעל כהן", nails.id, at(-30, 12), "הגיעה", 120, 70);
  await visit("יעל כהן", nails.id, at(0, 11), "הגיעה", 120, 70, "מילוי");
  await visit("הילה לוי", nails.id, at(0, 14), "הגיעה", 120, 70);
  await visit("מאיה פרץ", nails.id, at(-45, 15), "הגיעה", 120, 70);
  await visit("רונית ביטון", nails.id, at(-75, 9), "הגיעה", 120, 70);
  await visit("שירן דהן", nails.id, at(-20, 13), "הגיעה", 120, 70);
  await visit("שירן דהן", nails.id, at(-8, 13), "הגיעה", 120, 70);
  await visit("שירן דהן", nails.id, at(0, 16), "נקבע", 120, 70);
  await visit("ליאת אוחיון", nails.id, at(-12, 18), "לא הגיעה", 120, 70);
  await visit("ליאת אוחיון", nails.id, at(1, 10), "נקבע", 120, 70);
  await visit("עדן מזרחי", face.id, at(-2, 17), "הגיעה", 120, 60, "טיפול ראשון");
  await visit("תמר אלקיים", nails.id, at(2, 12), "נקבע", 120, 70);
  await visit("אורטל חדד", nails.id, at(-14, 11), "הגיעה", 120, 70);
  await visit("אורטל חדד", nails.id, at(-6, 11), "הגיעה", 120, 70);
  await visit("אורטל חדד", nails.id, at(3, 15), "נקבע", 108, 70);
  await visit("לין אבו", nails.id, at(1, 14), "נקבע", 120, 70);

  const grades: [string, string, string, Date | null][] = [
    ["מיכל אברהם", nails.id, "קבועה", at(-70, 10)],
    ["יעל כהן", nails.id, "חוזרת", at(-30, 12)],
    ["הילה לוי", nails.id, "חדשה", at(0, 14)],
    ["מאיה פרץ", nails.id, "בסיכון", at(-45, 15)],
    ["רונית ביטון", nails.id, "רדומה", at(-75, 9)],
    ["שירן דהן", nails.id, "קבועה", at(-20, 13)],
    ["ליאת אוחיון", nails.id, "חדשה", at(1, 10)],
    ["עדן מזרחי", face.id, "חדשה", at(-2, 17)],
    ["תמר אלקיים", nails.id, "חדשה", null],
    ["אורטל חדד", nails.id, "קבועה", at(-14, 11)],
  ];
  for (const [name, serviceId, opsStatus, first] of grades) {
    await prisma.contactService.create({
      data: { contactId: made[name], serviceId, opsStatus, firstVisitAt: first, lastVisitAt: first },
    });
  }

  await prisma.credit.create({
    data: { contactId: made["מיכל אברהם"], percent: 10, remainingPct: 10, expiresAt: at(80, 12) },
  });
  await prisma.questionnaireResponse.create({
    data: {
      contactId: made["אורטל חדד"],
      serviceId: nails.id,
      answers: { allergy: "לא, אין לי רגישות ידועה", last: "לפני שלושה שבועות", style: "צרפתי עדין" },
    },
  });
  await prisma.timelineEvent.create({
    data: { contactId: made["מיכל אברהם"], type: "note", actor: "user", payload: { text: "אוהבת גוונים חמים, בלי נצנצים." } },
  });
  await prisma.calendarReview.createMany({
    data: [
      { googleEventId: "demo-nt", title: "לק ג'ל [NT:052-700-1101]", detectedPhone: "+972527001101", status: "open" },
      { googleEventId: "demo-block", title: "חסימה אישית", detectedPhone: null, status: "open" },
    ],
  });
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
