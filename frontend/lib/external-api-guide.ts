type Block =
  | { kind: "h2"; text: string }
  | { kind: "p"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "code"; text: string };

export function externalApiBlocks(base: string): Block[] {
  const root = `${base}/api/v1/external`;
  return [
  { kind: "p", text: "זה ה־API שטוקן פותח. שירה, וכל מערכת אחרת, קוראות רק לכאן. המסכים של נועה עובדים עם עוגיית התחברות, והטוקן הזה לא נכנס אליהם ולא מוחק כרטיס, לא קובע תור, ולא משנה מחיר." },
  { kind: "h2", text: "כתובת" },
  { kind: "p", text: `הבסיס נלקח מ־FRONTEND_URL בשרת, בלי סלאש בסוף, ואז /backend. עכשיו הוא ${base}. הקריאות עצמן ממשיכות ב־/api/v1/external.` },
  { kind: "h2", text: "אימות" },
  { kind: "p", text: "בכל קריאה כותרת אחת:" },
  { kind: "code", text: "Authorization: Bearer YOUR_TOKEN\nContent-Type: application/json" },
  { kind: "list", items: [
    "הטוקן הוא 64 תווים הקסדצימליים. הוא מוצג פעם אחת ביצירה, ובמסד נשמר רק hash.",
    "בלי כותרת, או עם ערך ריק: 401, code unauthorized, message חסר מפתח.",
    "טוקן לא קיים, שנמחק, או שכבוי: 401, code unauthorized, message המפתח לא פעיל.",
    "אחרי אימות מוצלח מתעדכן lastUsedAt, גם אם הכרטיס אחר כך לא נמצא.",
  ] },
  { kind: "h2", text: "טלפון בכתובת" },
  { kind: "p", text: "כל פורמט ישראלי תקין. השרת שומר E.164, למשל +972521234567. בכתובת עדיף בלי סימן פלוס, כי פלוס צריך קידוד %2B." },
  { kind: "code", text: "/contacts/052-123-4567\n/contacts/0521234567\n/contacts/%2B972521234567" },
  { kind: "p", text: "מספר לא תקין: 400, code invalid_phone, message מספר הטלפון לא תקין, field phone. סיומת @s.whatsapp.net יורדת לפני הבדיקה." },
  { kind: "h2", text: "שגיאה" },
  { kind: "p", text: "כל שגיאה היא JSON. field מופיע רק כשיש שדה אחראי." },
  { kind: "code", text: "{\n  \"error\": {\n    \"code\": \"invalid\",\n    \"message\": \"חסר או לא תקין\",\n    \"field\": \"salesStatus\"\n  }\n}" },
  { kind: "list", items: [
    "400 invalid_phone: טלפון לא תקין.",
    "400 invalid: גוף לא תואם לסכמה. field הוא שם השדה.",
    "401 unauthorized: אין טוקן, או שהוא לא פעיל.",
    "404 not_found: אין כרטיס, או שקוד השירות לא קיים.",
    "422 invalid: salesStatus לא ברשימה. field הוא salesStatus.",
    "422 missing: סטטוס לא רלוונטית בלי notRelevantReason. field הוא notRelevantReason. הכרטיס לא משתנה ולא נוצר.",
  ] },
  { kind: "p", text: "אין היום מגבלת קצב על ה־API הזה. 429 לא חוזר מהקריאות האלה." },
  { kind: "h2", text: "GET /contacts/{phone}" },
  { kind: "p", text: "כרטיס אחד. 404 אם אין כרטיס. אין גוף בקשה." },
  { kind: "code", text: `curl -s \\\n  -H "Authorization: Bearer YOUR_TOKEN" \\\n  "${root}/contacts/0521234567"` },
  { kind: "p", text: "תשובה 200:" },
  { kind: "code", text: "{\n  \"id\": \"cm...\",\n  \"name\": \"רחל כהן\",\n  \"phone\": \"+972521234567\",\n  \"phoneOptive\": \"972521234567\",\n  \"phoneDisplay\": \"052-123-4567\",\n  \"source\": \"פנייה ישירה לנועה\",\n  \"sourceDetail\": null,\n  \"salesStatus\": \"ליד חדש\",\n  \"notRelevantReason\": null,\n  \"lastAiSummary\": null,\n  \"noShowCount\": 0,\n  \"createdAt\": \"2026-10-01T12:00:00.000Z\",\n  \"services\": [\n    {\n      \"code\": \"NAILS\",\n      \"name\": \"לק ג'ל\",\n      \"opsStatus\": \"חדשה\",\n      \"leftReason\": null,\n      \"firstVisitAt\": null,\n      \"lastVisitAt\": null\n    }\n  ],\n  \"upcomingAppointments\": [\n    {\n      \"id\": \"cm...\",\n      \"startsAt\": \"2026-10-05T06:00:00.000Z\",\n      \"endsAt\": \"2026-10-05T07:10:00.000Z\",\n      \"status\": \"נקבע\",\n      \"serviceCode\": \"NAILS\",\n      \"serviceName\": \"לק ג'ל\",\n      \"finalPrice\": 120\n    }\n  ],\n  \"credits\": [\n    { \"percent\": 10, \"remainingPct\": 10, \"expiresAt\": \"2027-01-01T00:00:00.000Z\" }\n  ]\n}" },
  { kind: "list", items: [
    "phone הוא E.164. phoneOptive הוא אותן ספרות בלי פלוס, בלי אפס מוביל. phoneDisplay הוא 052-123-4567.",
    "הזמנים ב־UTC. Asia/Jerusalem חל על החישוב, לא על מחרוזת התאריך.",
    "services הוא סטטוס התפעול לכל שירות שכבר יש לה. מערך ריק אם עוד אין שורת תפעול.",
    "upcomingAppointments: עד שלושה תורים עתידיים בסטטוס נקבע, מהקרוב לרחוק. תור שהגיעה, לא הגיעה, או בוטל לא נכנס.",
    "credits: רק זיכוי שעוד לא פג ונותר בו אחוז. percent הוא הגודל המקורי, remainingPct מה שנשאר.",
    "noShowCount הוא מספר פעמים שסומנה לא הגיעה.",
  ] },
  { kind: "h2", text: "POST /contacts/{phone}" },
  { kind: "p", text: "יוצרת ליד אם אין כרטיס, או מעדכנת רק שדות שנשלחו. גוף JSON חובה. אובייקט ריק {} חוקי ויוצר ליד בלי לשנות כרטיס קיים. שדה שלא נשלח נשאר. null לא חוקי. שדה לא מוכר נדחה ב־400, והכרטיס לא נכתב." },
  { kind: "code", text: `curl -s -X POST \\\n  -H "Authorization: Bearer YOUR_TOKEN" \\\n  -H "Content-Type: application/json" \\\n  -d '{"name":"רחל כהן","source":"מודעה ממומנת","summary":"רוצה ניוד"}' \\\n  "${root}/contacts/0521234567"` },
  { kind: "p", text: "שדות הגוף, כולם אופציונליים:" },
  { kind: "list", items: [
    "name: מחרוזת. ביצירה, ריק או חסר הופך ל«בלי שם». בעדכון, ערך שנשלח מחליף את השם.",
    "source: מחרוזת חופשית. ביצירה, ריק או חסר הופך ל«פנייה ישירה לנועה». הערכים שבמערכת: מודעה ממומנת, המלצה מלקוחה, קבוצת וואטסאפ, אינסטגרם אורגני, פנייה ישירה לנועה, אחר.",
    "salesStatus: אחד מהערכים למטה, בדיוק, כולל מקפים.",
    "notRelevantReason: חובה רק כש־salesStatus הוא לא רלוונטית. נשמר על הכרטיס.",
    "summary: מחליף את lastAiSummary, ומוסיף פריט ai_summary בציר הזמן. לא דורס הערות ישנות.",
    "note: מוסיף פריט note בציר הזמן. לא משנה את התקציר.",
  ] },
  { kind: "p", text: "salesStatus המותר:" },
  { kind: "code", text: "ליד חדש\nאין מענה ל-AI\nאין מענה 1\nאין מענה 2\nאין מענה 3\nנקבע תור AI\nנקבע תור אנושי\nלא הגיעה\nלא רלוונטית\nלקוחה פעילה" },
  { kind: "list", items: [
    "כרטיס חדש נשמר קודם כליד חדש, ואז הסטטוס שנשלח מוחל.",
    "אותו סטטוס שכבר שמור לא נכתב שוב, ו־messageQueued חוזר false.",
    "אין מענה 3 מתזמן הודעת וואטסאפ אחת ללקוחה, אם השליחה דולקת בהגדרות ועוד לא תוזמנה לה. messageQueued הוא true רק אז. כשההודעה נשלחת, הסטטוס הופך ללא רלוונטית עם הסיבה «שלושה ניסיונות בלי מענה».",
    "לקוחה פעילה פותחת שורת תפעול אם אין לה אחת.",
    "כל מעבר סטטוס נרשם בציר עם actor ai.",
  ] },
  { kind: "p", text: "תשובה 200 היא אותו כרטיס של GET, ועוד שדה אחד:" },
  { kind: "code", text: "{\n  \"id\": \"cm...\",\n  \"name\": \"רחל כהן\",\n  \"phone\": \"+972521234567\",\n  \"salesStatus\": \"ליד חדש\",\n  \"messageQueued\": false\n}" },
  { kind: "p", text: "השדות שלא מופיעים בדוגמה הקצרה עדיין חוזרים: phoneOptive, phoneDisplay, source, sourceDetail, notRelevantReason, lastAiSummary, noShowCount, createdAt, services, upcomingAppointments, credits." },
  { kind: "h2", text: "GET /contacts/{phone}/price" },
  { kind: "p", text: "מחיר מחירון אחרי זיכויים פעילים. פרמטר service הוא קוד שירות, לא השם בעברית. בלי פרמטר הקוד הוא NAILS. קוד לא קיים: 404, message השירות לא נמצא, field service. אין כרטיס: 200 עם contactFound false ומחיר בלי זיכוי." },
  { kind: "code", text: `curl -s \\\n  -H "Authorization: Bearer YOUR_TOKEN" \\\n  "${root}/contacts/0521234567/price?service=NAILS"` },
  { kind: "code", text: "{\n  \"service\": \"NAILS\",\n  \"name\": \"לק ג'ל\",\n  \"listPrice\": 120,\n  \"contactFound\": true,\n  \"discountPct\": 10,\n  \"discounted\": 108,\n  \"completions\": 0,\n  \"finalPrice\": 108\n}" },
  { kind: "list", items: [
    "הקודים שקיימים עכשיו: NAILS לק ג'ל, FACE טיפולי פנים.",
    "discountPct הוא סכום remainingPct של הזיכויים שעוד בתוקף, עם תקרה של 50.",
    "הנחה שכבר שמורה על תור לא נכנסת לחישוב הזה.",
    "completions תמיד 0 בקריאה הזו. finalPrice שווה ל־discounted.",
    "listPrice ו־finalPrice בשקלים. finalPrice יכול להיות עם אגורות, למשל 112.5.",
  ] },
  { kind: "h2", text: "מה הטוקן לא עושה" },
  { kind: "list", items: [
    "לא קובע תור, לא מזיז תור, ולא מסמן הגעה.",
    "לא משנה סטטוס תפעול. opsStatus רק נקרא בתוך services.",
    "לא מקבל campaign, referredByPhone, requestedService, attended, או opsStatus. אלה נדחים כשדה לא מוכר.",
    "לא שולח וואטסאפ בעצמו, חוץ מתופעת הלוואי של אין מענה 3.",
  ] },
  { kind: "h2", text: "שלוש פונקציות" },
  { kind: "p", text: "שם, שיטה, נתיב, ופרמטרים. הבסיס הוא FRONTEND_URL מהשרת." },
  { kind: "code", text: `get_contact\n  GET ${root}/contacts/{phone}\n  phone: מחרוזת, חובה, בנתיב\n\nupsert_contact\n  POST ${root}/contacts/{phone}\n  phone: מחרוזת, חובה, בנתיב\n  name, source, salesStatus, notRelevantReason, summary, note: אופציונליים, בגוף JSON\n\nget_price\n  GET ${root}/contacts/{phone}/price?service={code}\n  phone: מחרוזת, חובה, בנתיב\n  service: קוד שירות, אופציונלי, ברירת מחדל NAILS` },
];
}

export function externalApiGuideMarkdown(base: string) {
  const lines = ["# API חיצוני", ""];
  for (const block of externalApiBlocks(base)) {
    if (block.kind === "h2") lines.push(`## ${block.text}`, "");
    if (block.kind === "p") lines.push(block.text, "");
    if (block.kind === "list") lines.push(...block.items.map((item) => `- ${item}`), "");
    if (block.kind === "code") lines.push("```", block.text, "```", "");
  }
  return lines.join("\n").trim() + "\n";
}
