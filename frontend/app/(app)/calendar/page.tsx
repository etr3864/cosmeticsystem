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
type Hold = { id: string; title: string; startsAt: string; endsAt: string };

const tone = { set: "#522A0C", arrived: "#3F6B3A", missed: "#9B2F45", unmarked: "#8A817A", cancelled: "#665B53", hold: "#8A817A" };

export default function CalendarPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [holds, setHolds] = useState<Hold[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [hold, setHold] = useState<Hold | null>(null);
  const [editing, setEditing] = useState<Item | null>(null);
  const [draft, setDraft] = useState<Date | null>(null);
  const [cardId, setCardId] = useState<string | null>(null);
  const [view, setView] = useState("dayGridMonth");
  const [narrow, setNarrow] = useState(false);
  const [onToday, setOnToday] = useState(true);
  const [title, setTitle] = useState("");
  const range = useRef("");
  const monthNav = useRef(false);
  const calendarRef = useRef<FullCalendar>(null);

  function load(from: Date, to: Date) {
    api<{ items: Item[]; holds?: Hold[] }>(`/appointments?from=${from.toISOString()}&to=${to.toISOString()}`).then((data) => {
      setItems(data.items);
      setHolds(data.holds ?? []);
    }).catch(() => { setItems([]); setHolds([]); });
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
    const media = window.matchMedia("(max-width: 1023px)");
    const apply = () => { setNarrow(media.matches); fit(); };
    apply();
    media.addEventListener("change", apply);
    window.addEventListener("resize", fit);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
      media.removeEventListener("change", apply);
      window.removeEventListener("resize", fit);
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
    const held = holdId(info.event.id);
    try {
      if (held) {
        await api(`/appointments/holds/${held}/move`, { method: "POST", body: JSON.stringify({ startsAt: info.event.start?.toISOString(), endsAt: info.event.end?.toISOString() }) });
        pushToast("האירוע זז");
        reload();
        return;
      }
      await api(`/appointments/${info.event.id}/move`, { method: "POST", body: JSON.stringify({ startsAt: info.event.start?.toISOString() }) });
      pushToast("התור זז");
    } catch (error) {
      info.revert();
      pushToast(error instanceof Error ? error.message : "השעה נתפסה");
    }
  }

  async function resize(info: { event: { id: string; start: Date | null; end: Date | null }; revert: () => void }) {
    if (!info.event.start || !info.event.end) return info.revert();
    const held = holdId(info.event.id);
    try {
      if (held) {
        await api(`/appointments/holds/${held}/move`, { method: "POST", body: JSON.stringify({ startsAt: info.event.start.toISOString(), endsAt: info.event.end.toISOString() }) });
        pushToast("האירוע זז");
        reload();
        return;
      }
      await api(`/appointments/${info.event.id}`, { method: "PATCH", body: JSON.stringify({ startsAt: info.event.start.toISOString(), endsAt: info.event.end.toISOString() }) });
      pushToast("התור עודכן");
      reload();
    } catch (error) {
      info.revert();
      pushToast(error instanceof Error ? error.message : "השעה נתפסה");
    }
  }

  async function removeHold(id: string) {
    if (!window.confirm("למחוק את האירוע?")) return;
    try {
      await api(`/appointments/holds/${id}`, { method: "DELETE" });
      setHold(null);
      pushToast("נמחק");
      reload();
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "גוגל לא מחק");
    }
  }

  async function dismiss(id: string) {
    await api(`/appointments/reviews/${id}/dismiss`, { method: "POST" });
    setReviews((current) => current.filter((item) => item.id !== id));
    pushToast("נשמר");
  }

  return (
    <section className="relative h-full min-h-0">
      <div className="glass flex h-full min-h-0 flex-col overflow-hidden rounded-xl p-2 sm:p-4">
        <div className="cal-head mb-3 flex shrink-0 flex-col gap-3 lg:mb-4 lg:flex-row lg:flex-wrap lg:items-center lg:justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <button onClick={() => calendarRef.current?.getApi().prev()} className="rounded-full bg-white/80 px-3 py-2">הקודם</button>
            <button onClick={() => calendarRef.current?.getApi().next()} className="rounded-full bg-white/80 px-3 py-2">הבא</button>
            <button onClick={() => calendarRef.current?.getApi().today()} className={`rounded-full px-3 py-2 font-bold ${onToday ? "bg-brand text-onBrand" : "bg-white/80"}`}>היום</button>
            <h2 className="min-w-0 truncate px-1 text-xl lg:text-2xl">{title}</h2>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <div className="seg">
              {[["dayGridMonth", "חודש"], ["timeGridWeek", "שבוע"], ["timeGridDay", "יום"], ["listMonth", "רשימה"]].map(([id, label]) => (
                <button key={id} className={view === id ? "on" : ""} onClick={() => calendarRef.current?.getApi().changeView(id)}>{label}</button>
              ))}
            </div>
            <button onClick={() => openAt(nextSlot())} className="shrink-0 rounded-full bg-brand px-4 py-2 font-bold text-onBrand">תור חדש</button>
          </div>
        </div>
        {reviews.length > 0 ? (
          <div className="mb-3 shrink-0 space-y-2 rounded-lg bg-[#FBEFD5] p-3 text-[#875208]">
            {reviews.map((review) => (
              <div key={review.id} className="flex flex-wrap items-center justify-between gap-3">
                <span className="min-w-0 break-words">{review.title}{review.detectedPhone ? ` · ${review.detectedPhone}` : ""}</span>
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
          editable={!narrow}
          eventDurationEditable={!narrow && (view === "timeGridWeek" || view === "timeGridDay")}
          eventResizableFromStart={!narrow && (view === "timeGridWeek" || view === "timeGridDay")}
          dayMaxEvents={narrow ? 2 : 3}
          moreLinkText={(count) => `+${count}`}
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
          events={[
            ...items.map((item) => ({
              id: item.id,
              title: item.contact.name,
              start: item.startsAt,
              end: item.endsAt,
              extendedProps: item,
            })),
            ...holds.map((item) => ({
              id: `hold:${item.id}`,
              title: item.title,
              start: item.startsAt,
              end: item.endsAt,
              extendedProps: { ...item, kind: "hold" as const },
            })),
          ]}
          eventContent={(arg) => <Chip arg={arg} />}
          eventClick={(info) => {
            info.jsEvent.stopPropagation();
            const held = holdId(info.event.id);
            if (held) {
              setDraft(null);
              setEditing(null);
              setHold(holds.find((item) => item.id === held) ?? null);
              return;
            }
            setHold(null);
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
      {hold ? (
        <div className="pointer-events-none fixed inset-0 z-[80] flex items-end justify-center p-4 sm:items-center">
          <button type="button" className="drawer-bg pointer-events-auto !z-0" aria-label="סגירה" onClick={() => setHold(null)} />
          <div className="glass pointer-events-auto relative !z-10 w-[min(420px,100%)] rounded-xl p-5">
            <p className="text-[12px] font-bold tracking-[0.16em] text-goldInk">אירוע מגוגל</p>
            <h2 className="mt-1 text-2xl">{hold.title}</h2>
            <p className="mt-2 text-sm text-muted">{clock(new Date(hold.startsAt))}–{clock(new Date(hold.endsAt))}. זה לא תור. גרירה מזיזה אותו גם בגוגל.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" onClick={() => removeHold(hold.id)} className="rounded-full bg-[#9B2F45] px-5 py-2 text-white">מחיקה</button>
              <button type="button" onClick={() => setHold(null)} className="rounded-full bg-white px-5 py-2">סגירה</button>
            </div>
          </div>
        </div>
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
  const held = arg.event.extendedProps.kind === "hold";
  const item = arg.event.extendedProps as Item;
  const look = held ? "hold" : chipLook(item.status, arg.event.end);
  const month = arg.view.type === "dayGridMonth";
  const range = `${clock(arg.event.start)}–${clock(arg.event.end)}`;
  return (
    <span className={`nt-chip ${look}`} style={{ ["--st" as string]: tone[look] }}>
      <b>{held ? arg.event.title : arg.event.title.split(" ")[0]}</b>
      <span className="nt-when">{range}</span>
      {held ? <span className="nt-meta">גוגל</span> : month ? (
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

function holdId(value: string) {
  return value.startsWith("hold:") ? value.slice(5) : "";
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
