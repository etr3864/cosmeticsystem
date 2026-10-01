export const MESSAGE_DEFAULTS = {
  beshvilech:
    "{שם}, עוד מעט התור שלך אצל נועה. כשתגיעי תמלאי איתה את בשבילך. הקישור הזה הוא דף קצר, עם כמה דברים שעוברים עליהם יחד כדי להתאים לך את החומרים לפני שמתחילים: {קישור}",
  discount:
    "{שם}, נועה שמרה לך 10% הנחה על התור הבא, {מחיר_אחרי} במקום {מחיר}. זה נסגר בעוד 24 שעות ולא חוזר. הקישור פותח את השעות שעוד פנויות, עם ההנחה כבר על המחיר. חבל לפספס. כדאי להיכנס ולקבוע עכשיו: {קישור}",
  discountExisting:
    "{שם}, נועה שמרה לך 10% הנחה על התור שכבר קבוע, {מחיר_אחרי} במקום {מחיר}. בעוד 24 שעות ההנחה נמחקת. הקישור פותח את התור הזה עם ההנחה עליו: {קישור}",
  noShow:
    "{שם}, התור שלך אצל נועה ב־{תאריך} לא התקיים. אם מתאים לך זמן אחר, תכתבי כאן מתי נוח לך ונקבע מחדש.",
  becameRegular:
    "{שם}, מעכשיו את קבועה אצל נועה. הקישור הזה הוא דף שלך. יש בו כפתור ששולח לחברה הזמנה לוואטסאפ. היא מקבלת 10% הנחה על התור שלה, ואחרי שהיא מגיעה את מקבלת 10% ל־3 חודשים. בדף גם רואים כמה חברות הגיעו וכמה זיכוי נשאר לך: {קישור}",
  partnerLink:
    "{שם}, הקישור הזה הוא הדף שלך אצל נועה. יש בו כפתור ששולח לחברה הזמנה לוואטסאפ. היא מקבלת 10% הנחה על התור שלה, ואחרי שהיא מגיעה את מקבלת 10% ל־3 חודשים. בדף רואים כמה חברות הגיעו וכמה זיכוי נשאר: {קישור}",
  noAnswer3:
    "{שם}, נועה ניסתה להתקשר ולא הייתה תשובה. אם מתאים לך תור, כדאי לכתוב לכאן, כי הימים הקרובים מתמלאים.",
} as const;

export function firstName(fullName: string | null | undefined): string {
  const name = fullName?.trim().split(/\s+/)[0];
  return name || "";
}

export function renderTemplate(template: string, vars: Record<string, string>): string {
  const rendered = template.replace(/\{([^}]+)\}/g, (_, key: string) => vars[key] ?? "");
  const lines = rendered.split("\n").map((line) => line.replace(/[ \t]+/g, " ").trim());
  if (lines[0]) lines[0] = lines[0].replace(/^,+/, "").trim();
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function withFirstName(template: string, name: string, vars: Record<string, string>): string {
  const short = firstName(name);
  const personal = short ? template : template.replace(/^\{שם\},?\s*/, "");
  return renderTemplate(personal, { ...vars, שם: short });
}
