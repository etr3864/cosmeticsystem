import { addDays, atJerusalem, dayKey, weekdaySunday0 } from "./time.js";

const OPEN = 8 * 60;
const CLOSE = 20 * 60;

/** Sunday to Thursday, 08:00–20:00 Asia/Jerusalem. Friday and Saturday wait. */
export function nextSendAt(from: Date): Date {
  for (let offset = 0; offset < 8; offset += 1) {
    const day = addDays(dayKey(from), offset);
    const weekday = weekdaySunday0(atJerusalem(day, 12 * 60));
    if (weekday === 5 || weekday === 6) continue;
    const open = atJerusalem(day, OPEN);
    const close = atJerusalem(day, CLOSE);
    if (from < open) return open;
    if (from.getTime() <= close.getTime()) return from;
  }
  return atJerusalem(addDays(dayKey(from), 2), OPEN);
}
