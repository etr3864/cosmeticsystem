import { describe, expect, it } from "vitest";
import { bookingMonths, dayOffset, defaultBookingMonth, nearestOpenSlots, slotsForDay } from "./availability.js";

describe("slotsForDay", () => {
  it("returns nothing when Noa has not marked the day", () => {
    expect(slotsForDay({ window: null, durationMin: 70, bufferMin: 10, stepMin: 30, busy: [], earliestMin: 0 })).toEqual([]);
  });

  it("keeps a buffer around a busy appointment and stops at the end of her window", () => {
    const slots = slotsForDay({
      window: { startMin: 8 * 60, endMin: 12 * 60 },
      durationMin: 70,
      bufferMin: 10,
      stepMin: 30,
      busy: [{ startMin: 9 * 60, endMin: 10 * 60 + 10 }],
      earliestMin: 0,
    });
    expect(slots).not.toContain(9 * 60);
    expect(slots).toContain(10 * 60 + 30);
    expect(slots.every((start) => start + 70 <= 12 * 60)).toBe(true);
  });
});

describe("public booking window", () => {
  it("counts calendar days without caring about the hour", () => {
    expect(dayOffset("2026-10-24", "2026-10-03")).toBe(21);
    expect(dayOffset("2026-10-03", "2026-10-03")).toBe(0);
  });

  it("opens on next month and names the current one", () => {
    const months = bookingMonths(["2026-10-04", "2026-10-25", "2026-11-02", "2026-12-01"], "2026-10-03");
    expect(months).toEqual([
      { key: "2026-10", relation: "current" },
      { key: "2026-11", relation: "next" },
      { key: "2026-12", relation: "later" },
    ]);
    expect(defaultBookingMonth(months)).toBe("2026-11");
    expect(defaultBookingMonth(bookingMonths(["2026-10-04"], "2026-10-03"))).toBe("2026-10");
  });

  it("offers the same day before it jumps to another day", () => {
    const wanted = "2026-11-04T08:00:00.000Z";
    const open = [
      "2026-11-04T10:00:00.000Z",
      "2026-11-05T08:00:00.000Z",
      "2026-11-04T06:30:00.000Z",
      "2026-11-04T08:00:00.000Z",
    ];
    expect(nearestOpenSlots(open, wanted)).toEqual([
      "2026-11-04T06:30:00.000Z",
      "2026-11-04T10:00:00.000Z",
      "2026-11-05T08:00:00.000Z",
    ]);
  });
});
