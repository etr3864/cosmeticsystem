import { describe, expect, it } from "vitest";
import { gradeFromVisits, resolveOpsStatus, salesStatusAfterBooking, salesTransitionMissing } from "./statuses.js";

describe("ops status", () => {
  it("derives the grade from visits", () => {
    expect(gradeFromVisits(1)).toBe("חדשה");
    expect(gradeFromVisits(2)).toBe("חוזרת");
    expect(gradeFromVisits(4)).toBe("קבועה");
  });

  it("lets risk and dormant override the grade until a future visit exists", () => {
    const base = { visits: 3, atRiskDays: 28, dormantDays: 60, left: false, hasFutureAppointment: false };
    expect(resolveOpsStatus({ ...base, daysSinceLastVisit: 10 })).toBe("קבועה");
    expect(resolveOpsStatus({ ...base, daysSinceLastVisit: 30 })).toBe("בסיכון");
    expect(resolveOpsStatus({ ...base, daysSinceLastVisit: 70 })).toBe("רדומה");
    expect(resolveOpsStatus({ ...base, daysSinceLastVisit: 70, hasFutureAppointment: true })).toBe("קבועה");
  });

  it("keeps an active client on booking and parks everyone else on the booked step", () => {
    expect(salesStatusAfterBooking("לקוחה פעילה", "AI")).toBeNull();
    expect(salesStatusAfterBooking("לקוחה פעילה", "נועה")).toBeNull();
    expect(salesStatusAfterBooking("ליד חדש", "AI")).toBe("נקבע תור AI");
    expect(salesStatusAfterBooking("אין מענה 2", "נועה")).toBe("נקבע תור אנושי");
    expect(salesStatusAfterBooking("לא רלוונטית", "המלצה")).toBe("נקבע תור אנושי");
  });

  it("requires a reason when a lead is not relevant", () => {
    expect(salesTransitionMissing("לא רלוונטית", "  ")).toBe("סיבה");
    expect(salesTransitionMissing("לא רלוונטית", "רחוקה")).toBeNull();
  });
});
