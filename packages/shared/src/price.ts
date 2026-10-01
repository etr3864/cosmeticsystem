export type PriceBreakdown = {
  discountPct: number;
  discounted: number;
  completions: number;
  finalPrice: number;
};

const CAP = 50;

export function calculatePrice(
  listPrice: number,
  discounts: number[],
  creditsToUse: number[],
  completionCount = 0,
  completionUnit = 10,
): PriceBreakdown {
  const sum = [...discounts, ...creditsToUse].reduce((total, value) => total + value, 0);
  const discountPct = Math.min(CAP, Math.max(0, sum));
  const discounted = roundMoney(listPrice * (1 - discountPct / 100));
  const completions = completionCount * completionUnit;
  return {
    discountPct,
    discounted,
    completions,
    finalPrice: roundMoney(discounted + completions),
  };
}

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function priceAfterPercent(listPrice: number, percent: number): number {
  return calculatePrice(listPrice, [percent], []).finalPrice;
}
