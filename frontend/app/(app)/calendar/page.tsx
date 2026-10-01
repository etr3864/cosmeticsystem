"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import listPlugin from "@fullcalendar/list";
import interactionPlugin from "@fullcalendar/interaction";
import heLocale from "@fullcalendar/core/locales/he";
import type { DatesSetArg, DayCellContentArg, EventContentArg, EventDropArg } from "@fullcalendar/core";
import { api } from "@/lib/api";
import { pushToast } from "@/components/toast";
import { BookingDialog } from "@/components/booking-dialog";
import { ContactDrawer } from "@/components/contact-drawer";

type Item = {
  id: string;
  startsAt: string;
  endsAt: string;
  status: string;
  finalPrice: number;
  motherDaughter: boolean;
  notes: string | null;
  contact: { id: string; name: string };
  service: { id: string; name: string };
};
type Review = { id: string; title: string; detectedPhone: string | null };

const tone = { set: "#522A0C", arrived: "#3F6B3A", missed: "#9B2F45", unmarked: "#8A817A", cancelled: "#665B53" };

export default function CalendarPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [editing, setEditing] = useState<Item | null>(null);
  const [draft, setDraft] = useState<Date | null>(null);
  const [cardId, setCardId] = useState<string | null>(null);
  const [view, setView] = useState("dayGridMonth");
  const [onToday, setOnToday] = useState(true);
  const [title, setTitle] = useState("");
  const range = useRef("");
  const monthNav = useRef(false);
  const calendarRef = useRef<FullCalendar>(null);

  function load(from: Date, to: Date) {
    api<{ items: Item[] }>(`/appointments?from=${from.toISOString()}&to=${to.toISOString()}`).then((data) => setItems(data.items)).catch(() => setItems([]));
    api<{ items: Review[] }>("/appointments/reviews").then((data) => setReviews(data.items)).catch(() => setReviews([]));
  }

  function reload() {
    const [start, end] = range.current.split("|");
    if (start && end) load(new Date(start), new Date(end));
  }

  useEffect(() => {
    const fit = () => calendarRef.current?.getApi().updateSize();
    const frame = requestAnimationFrame(fit);
    const timer = window.setTimeout(fit, 760);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    function onDown(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      const cell = target?.closest(".fc-daygrid-day");
      if (!cell || calendarRef.current?.getApi().view.type !== "dayGridMonth") return;
      if (target?.closest(".day-plus, .fc-event, .fc-daygrid-event-harness, .fc-more-link")) return;
      const date = cell.getAttribute("data-date");
      if (!date) return;
      monthNav.current = true;
      event.stopPropagation();
      calendarRef.current?.getApi().changeView("timeGridDay", date);
      window.setTimeout(() => { monthNav.current = false; }, 0);
    }
    document.addEventListener("mousedown", onDown, true);
    return () => document.removeEventListener("mousedown", onDown, true);
  }, []);

  function onDates(arg: DatesSetArg) {
    setTitle(arg.view.title);
    setView(arg.view.type);
    setOnToday(jerusalemDay(arg.view.calendar.getDate()) === jerusalemDay(new Date()));
    const key = `${arg.start.toISOString()}|${arg.end.toISOString()}`;
    if (range.current === key) return;
    range.current = key;
    load(arg.start, arg.end);
  }

  function openAt(date: Date) {
    const next = new Date(date);
    next.setSeconds(0, 0);
    const snapped = Math.round(next.getMinutes() / 30) * 30;
    next.setMinutes(0, 0, 0);
    next.setHours(next.getHours() + (snapped === 60 ? 1 : 0));
    if (snapped !== 60) next.setMinutes(snapped);
    setEditing(null);
    setDraft(next);
  }

  function onDateClick(info: { date: Date; view: { type: string }; jsEvent: { target: EventTarget | null } }) {
    const target = info.jsEvent.target as HTMLElement | null;
    if (target?.closest(".day-plus, .fc-event")) return;
    if (info.view.type === "dayGridMonth" || monthNav.current) return;
    openAt(info.date);
  }

  async function move(info: EventDropArg) {
    try {
      await api(`/appointments/${info.event.id}/move`, { method: "POST", body: JSON.stringify({ startsAt: info.event.start?.toISOString() }) });
      pushToast("התור זז");
    } catch (error) {
      info.revert();
      pushToast(error instanceof Error ? error.message : "השעה נתפסה");
    }
  }

  async function resize(info: { event: { id: string; start: Date | null; end: Date | null }; revert: () => void }) {
    if (!info.event.start || !info.event.end) return info.revert();
    try {
      await api(`/appointments/${info.event.id}`, { method: "PATCH", body: JSON.stringify({ startsAt: info.event.start.toISOString(), endsAt: info.event.end.toISOString() }) });
      pushToast("התור עודכן");
      reload();
    } catch (error) {
      info.revert();
      pushToast(error instanceof Error ? error.message : "השעה נתפסה");
    }
  }

  async function dismiss(id: string) {
    await api(`/appointments/reviews/${id}/dismiss`, { method: "POST" });
    setReviews((current) => current.filter((item) => item.id !== id));
    pushToast("נשמר");
  }

  return (
    <section className="relative h-full min-h-0">
      <div className="glass flex h-full min-h-0 flex-col overflow-hidden rounded-xl p-4">
        <div className="cal-head mb-4 flex shrink-0 flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button onClick={() => calendarRef.current?.getApi().prev()} className="rounded-full bg-white/80 px-3 py-2">הקודם</button>
            <button onClick={() => calendarRef.current?.getApi().next()} className="rounded-full bg-white/80 px-3 py-2">הבא</button>
            <button onClick={() => calendarRef.current?.getApi().today()} className={`rounded-full px-3 py-2 font-bold ${onToday ? "bg-brand text-onBrand" : "bg-white/80"}`}>היום</button>
            <h2 className="px-2 text-2xl">{title}</h2>
          </div>
          <div className="flex items-center gap-3">
            <div className="seg">
              {[["dayGridMonth", "חודש"], ["timeGridWeek", "שבוע"], ["timeGridDay", "יום"], ["listMonth", "רשימה"]].map(([id, label]) => (
                <button key={id} className={view === id ? "on" : ""} onClick={() => calendarRef.current?.getApi().changeView(id)}>{label}</button>
              ))}
            </div>
            <button onClick={() => openAt(nextSlot())} className="rounded-full bg-brand px-4 py-2 font-bold text-onBrand">תור חדש</button>
          </div>
        </div>
        {reviews.length > 0 ? (
          <div className="mb-3 shrink-0 space-y-2 rounded-lg bg-[#FBEFD5] p-3 text-[#875208]">
            {reviews.map((review) => (
              <div key={review.id} className="flex items-center justify-between gap-3">
                <span>{review.title}{review.detectedPhone ? ` · ${review.detectedPhone}` : ""}</span>
                <button onClick={() => dismiss(review.id)} className="rounded-md bg-white px-3 py-1 text-ink">סגירה</button>
              </div>
            ))}
          </div>
        ) : null}
        <div className="nt-cal min-h-0 flex-1">
        <FullCalendar
          ref={calendarRef}
          plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
          initialView="dayGridMonth"
          locale={heLocale}
          direction="rtl"
          height="100%"
          editable
          eventDurationEditable={view === "timeGridWeek" || view === "timeGridDay"}
          eventResizableFromStart={view === "timeGridWeek" || view === "timeGridDay"}
          dayMaxEvents={3}
          nowIndicator
          allDaySlot={false}
          slotMinTime="08:00:00"
          slotMaxTime="21:00:00"
          scrollTime="08:00:00"
          slotDuration="00:30:00"
          headerToolbar={false}
          datesSet={onDates}
          dateClick={onDateClick}
          dayCellContent={(arg) => <DayLabel arg={arg} onPlus={() => openAt(atNine(arg.date))} />}
          eventDrop={move}
          eventResize={resize}
          events={items.map((item) => ({
            id: item.id,
            title: item.contact.name,
            start: item.startsAt,
            end: item.endsAt,
            extendedProps: item,
          }))}
          eventContent={(arg) => <Chip arg={arg} />}
          eventClick={(info) => {
            info.jsEvent.stopPropagation();
            setDraft(null);
            setEditing(items.find((item) => item.id === info.event.id) ?? null);
          }}
        />
        </div>
      </div>
      {draft ? <BookingDialog startsAt={draft} onClose={() => setDraft(null)} onBooked={(contactId) => { setDraft(null); setCardId(contactId); reload(); }} /> : null}
      {editing ? (
        <BookingDialog
          startsAt={new Date(editing.startsAt)}
          existing={{ id: editing.id, contactId: editing.contact.id, contactName: editing.contact.name, serviceId: editing.service.id, notes: editing.notes ?? "", durationMin: Math.max(30, Math.round((new Date(editing.endsAt).getTime() - new Date(editing.startsAt).getTime()) / 60000)), status: editing.status, ended: new Date(editing.endsAt).getTime() < Date.now() }}
          onClose={() => setEditing(null)}
          onOpenCard={() => { setCardId(editing.contact.id); setEditing(null); }}
          onBooked={() => { setEditing(null); reload(); }}
        />
      ) : null}
      {cardId ? <ContactDrawer id={cardId} kind="lead" onChanged={reload} onClose={() => { setCardId(null); reload(); }} /> : null}
    </section>
  );
}

function DayLabel({ arg, onPlus }: { arg: DayCellContentArg; onPlus: () => void }) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [frame, setFrame] = useState<Element | null>(null);
  useEffect(() => {
    setFrame(anchor.current?.closest(".fc-daygrid-day-frame") ?? null);
  }, [arg.date]);
  if (arg.view.type !== "dayGridMonth") return <span>{arg.dayNumberText}</span>;
  const plus = (
    <button type="button" className="day-plus" aria-label="תור ביום הזה" onMouseDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); event.preventDefault(); onPlus(); }}>+</button>
  );
  return (
    <>
      <span ref={anchor}>{arg.dayNumberText}</span>
      {frame ? createPortal(plus, frame) : null}
    </>
  );
}

function Chip({ arg }: { arg: EventContentArg }) {
  const item = arg.event.extendedProps as Item;
  const look = chipLook(item.status, arg.event.end);
  const month = arg.view.type === "dayGridMonth";
  const range = `${clock(arg.event.start)}–${clock(arg.event.end)}`;
  return (
    <span className={`nt-chip ${look}`} style={{ ["--st" as string]: tone[look] }}>
      <b>{arg.event.title.split(" ")[0]}</b>
      <span className="nt-when">{range}</span>
      {month ? (
        item.notes ? <span className="nt-note">{item.notes}</span> : <span className="nt-meta">{item.service?.name}</span>
      ) : (
        <>
          {item.service?.name ? <span className="nt-meta">{item.service.name}</span> : null}
          {item.notes ? <span className="nt-note">{item.notes}</span> : null}
        </>
      )}
    </span>
  );
}

function chipLook(status: string, end: Date | null): keyof typeof tone {
  const past = Boolean(end && end.getTime() < Date.now());
  if (status === "הגיעה") return "arrived";
  if (status === "בוטל") return "cancelled";
  if (!past) return "set";
  if (status === "לא הגיעה") return "missed";
  return "unmarked";
}

function jerusalemDay(date: Date) {
  return date.toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
}

function clock(value: Date | null) {
  if (!value) return "";
  return value.toLocaleTimeString("he-IL", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit" });
}

function atNine(date: Date) {
  const next = new Date(date);
  next.setHours(9, 0, 0, 0);
  return next;
}

function nextSlot() {
  const next = new Date();
  next.setSeconds(0, 0);
  if (next.getMinutes() < 30) next.setMinutes(30);
  else {
    next.setHours(next.getHours() + 1);
    next.setMinutes(0);
  }
  if (next.getHours() < 8) next.setHours(9, 0, 0, 0);
  return next;
}
