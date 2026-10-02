export const SALES_STATUSES = [
  "ליד חדש",
  "אין מענה ל-AI",
  "אין מענה 1",
  "אין מענה 2",
  "אין מענה 3",
  "נקבע תור AI",
  "נקבע תור אנושי",
  "לא הגיעה",
  "לא רלוונטית",
  "לקוחה פעילה",
] as const;

export const OPS_STATUSES = ["חדשה", "חוזרת", "קבועה", "בסיכון", "רדומה", "עזבה"] as const;

export const APPOINTMENT_STATUSES = ["נקבע", "הגיעה", "לא הגיעה", "בוטל"] as const;

export const SOURCES = [
  "מודעה ממומנת",
  "המלצה מלקוחה",
  "קבוצת וואטסאפ",
  "אינסטגרם אורגני",
  "פנייה ישירה לנועה",
  "אחר",
] as const;

export type SalesStatus = (typeof SALES_STATUSES)[number];
export type OpsStatus = (typeof OPS_STATUSES)[number];
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];
export type Source = (typeof SOURCES)[number];

export type Grade = "חדשה" | "חוזרת" | "קבועה";

export function isSalesStatus(value: string): value is SalesStatus {
  return (SALES_STATUSES as readonly string[]).includes(value);
}

export function gradeFromVisits(visits: number): Grade | null {
  if (visits <= 0) return null;
  if (visits === 1) return "חדשה";
  if (visits === 2) return "חוזרת";
  return "קבועה";
}

export function resolveOpsStatus(input: {
  visits: number;
  daysSinceLastVisit: number | null;
  hasFutureAppointment: boolean;
  atRiskDays: number;
  dormantDays: number;
  left: boolean;
}): OpsStatus | null {
  if (input.left) return "עזבה";
  const grade = gradeFromVisits(input.visits);
  if (!grade) return null;
  if (!input.hasFutureAppointment && input.daysSinceLastVisit != null) {
    if (input.daysSinceLastVisit >= input.dormantDays) return "רדומה";
    if (input.daysSinceLastVisit >= input.atRiskDays) return "בסיכון";
  }
  return grade;
}

const REASON_REQUIRED = new Set<SalesStatus>(["לא רלוונטית"]);

export function salesTransitionMissing(status: SalesStatus, reason?: string | null): string | null {
  if (REASON_REQUIRED.has(status) && !reason?.trim()) return "סיבה";
  return null;
}

export function salesStatusAfterBooking(current: string, bookedBy: string): SalesStatus | null {
  if (current === "לקוחה פעילה") return null;
  return bookedBy === "AI" ? "נקבע תור AI" : "נקבע תור אנושי";
}

export function opsLeaveMissing(status: OpsStatus, reason?: string | null): string | null {
  if (status === "עזבה" && !reason?.trim()) return "סיבת עזיבה";
  return null;
}
