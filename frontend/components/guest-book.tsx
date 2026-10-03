"use client";

import { useMemo, useState } from "react";
import { bookingMonths, defaultBookingMonth, nearestOpenSlots, type MonthRelation } from "@noa/shared";
import { guestClock, guestDay, guestWhen } from "@/components/guest";

export type OpenDay = { day: string; slots: string[] };

const RELATION: Record<MonthRelation, string> = { current: "נוכחי", next: "הבא", later: "אחר כך" };

export function GuestDayPick({
  days,
  selected,
  onSelect,
  taken,
}: {
  days: OpenDay[];
  selected: string;
  onSelect: (slot: string) => void;
  taken: string;
}) {
  const open = useMemo(() => days.filter((day) => day.slots.length > 0), [days]);
  const months = useMemo(() => bookingMonths(open.map((day) => day.day)), [open]);
  const [month, setMonth] = useState("");
  const [active, setActive] = useState("");
  const activeMonth = months.some((item) => item.key === month) ? month : defaultBookingMonth(months);
  const inMonth = open.filter((day) => day.day.startsWith(activeMonth));
  const chosen = inMonth.find((day) => day.day === active) ?? inMonth.find((day) => day.slots.includes(selected));
  const alternatives = taken ? nearestOpenSlots(open.flatMap((day) => day.slots), taken) : [];

  function pickMonth(key: string) {
    setMonth(key);
    setActive("");
    const stays = open.some((day) => day.day.startsWith(key) && day.slots.includes(selected));
    if (!stays) onSelect("");
  }

  function look(day: OpenDay) {
    setMonth(day.day.slice(0, 7));
    setActive(day.day);
    if (!day.slots.includes(selected)) onSelect("");
  }

  function choose(slot: string) {
    const day = open.find((item) => item.slots.includes(slot));
    if (day) {
      setMonth(day.day.slice(0, 7));
      setActive(day.day);
    }
    onSelect(slot);
  }

  return (
    <section className="guest-card p-5 sm:p-6">
      <h2 className="text-center text-[28px] leading-9 text-ink">מתי התור?</h2>
      <p className="mt-2 text-center text-sm leading-6 text-muted">קודם חודש, אחר כך יום, ואז שעה.</p>
      {months.length === 0 ? (
        <p className="mt-6 text-center text-muted">אין שעות פנויות בחלון הזה.</p>
      ) : (
        <>
          <div className="guest-months">
            {months.map((item) => (
              <button key={item.key} type="button" onClick={() => pickMonth(item.key)} className={item.key === activeMonth ? "guest-month-pick on" : "guest-month-pick"}>
                <strong>{monthLong(item.key)}</strong>
                <span>{RELATION[item.relation]}</span>
              </button>
            ))}
          </div>
          <DayRow days={inMonth} chosen={chosen?.day ?? ""} onLook={look} />
          {chosen ? <Times day={chosen} selected={selected} onSelect={choose} /> : <p className="mt-4 text-center text-sm text-muted">בחרי יום</p>}
        </>
      )}
      {alternatives.length > 0 ? <Alternatives slots={alternatives} onChoose={choose} /> : null}
    </section>
  );
}

function DayRow({ days, chosen, onLook }: { days: OpenDay[]; chosen: string; onLook: (day: OpenDay) => void }) {
  return (
    <div className="guest-days mt-4">
      {days.map((day) => (
        <button key={day.day} type="button" onClick={() => onLook(day)} className={chosen === day.day ? "guest-day on" : "guest-day"}>
          <span>{weekday(day.day)}</span>
          <strong>{dayNumber(day.day)}</strong>
        </button>
      ))}
    </div>
  );
}

function Times({ day, selected, onSelect }: { day: OpenDay; selected: string; onSelect: (slot: string) => void }) {
  return (
    <div className="mt-5">
      <p className="text-center text-sm font-bold text-goldInk">{guestDay(day.day)}</p>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {day.slots.map((slot) => (
          <button key={slot} type="button" onClick={() => onSelect(slot)} className={selected === slot ? "guest-time on" : "guest-time"}>
            {guestClock(slot)}
          </button>
        ))}
      </div>
      {selected && day.slots.includes(selected) ? <p className="mt-4 text-center text-base text-ink">{guestWhen(selected)}</p> : null}
    </div>
  );
}

function Alternatives({ slots, onChoose }: { slots: string[]; onChoose: (slot: string) => void }) {
  return (
    <div className="mt-5">
      <p className="text-sm font-bold text-[#9B2F45]">השעה נתפסה. אלה הקרובות שעוד פנויות.</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {slots.map((slot) => (
          <button key={slot} type="button" onClick={() => onChoose(slot)} className="guest-time">{slotStamp(slot)}</button>
        ))}
      </div>
    </div>
  );
}

function atNoon(day: string) {
  return new Date(`${day.length === 7 ? `${day}-01` : day}T12:00:00Z`);
}

function monthLong(key: string) {
  return atNoon(key).toLocaleDateString("he-IL", { timeZone: "Asia/Jerusalem", month: "long" });
}

function weekday(day: string) {
  return atNoon(day).toLocaleDateString("he-IL", { timeZone: "Asia/Jerusalem", weekday: "short" });
}

function dayNumber(day: string) {
  return atNoon(day).toLocaleDateString("he-IL", { timeZone: "Asia/Jerusalem", day: "numeric" });
}

function slotStamp(iso: string) {
  const when = new Date(iso).toLocaleDateString("he-IL", { timeZone: "Asia/Jerusalem", day: "numeric", month: "short" });
  return `${when} ${guestClock(iso)}`;
}
