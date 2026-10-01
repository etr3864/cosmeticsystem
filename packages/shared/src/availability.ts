export type BusyRange = { startMin: number; endMin: number };

export type DayWindow = { startMin: number; endMin: number };

export function slotsForDay(input: {
  window: DayWindow | null;
  durationMin: number;
  bufferMin: number;
  stepMin: number;
  busy: BusyRange[];
  earliestMin: number;
}): number[] {
  if (!input.window) return [];
  const blocked = input.busy.map((range) => ({
    startMin: range.startMin - input.bufferMin,
    endMin: range.endMin + input.bufferMin,
  }));
  const slots: number[] = [];
  for (let start = input.window.startMin; start <= input.window.endMin - input.durationMin; start += input.stepMin) {
    if (start < input.earliestMin) continue;
    const end = start + input.durationMin;
    const hits = blocked.some((range) => start < range.endMin && end > range.startMin);
    if (!hits) slots.push(start);
  }
  return slots;
}

export function minutesFromClock(clock: string): number {
  const [hour, minute] = clock.split(":").map(Number);
  return (hour ?? 0) * 60 + (minute ?? 0);
}

/** 0 = Sunday. Noa marks which days exist; nothing is assumed. */
export type MarkedWeek = Partial<Record<number, DayWindow | null>>;
