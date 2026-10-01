import { describe, expect, it } from "vitest";
import { slotsForDay } from "./availability.js";

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
