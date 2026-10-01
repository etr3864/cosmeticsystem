import { describe, expect, it } from "vitest";
import { calculatePrice } from "./price.js";

describe("calculatePrice", () => {
  it("stacks discounts and caps them at 50 percent", () => {
    const price = calculatePrice(120, [10, 10, 10, 10, 10, 10], []);
    expect(price.discountPct).toBe(50);
    expect(price.finalPrice).toBe(60);
  });

  it("keeps nail completions outside the discount", () => {
    const price = calculatePrice(120, [10], [], 2, 10);
    expect(price.discounted).toBe(108);
    expect(price.completions).toBe(20);
    expect(price.finalPrice).toBe(128);
  });

  it("applies chosen credits inside the cap", () => {
    const price = calculatePrice(120, [10], [10]);
    expect(price.discountPct).toBe(20);
    expect(price.finalPrice).toBe(96);
  });
});
