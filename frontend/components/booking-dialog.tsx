"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "@/lib/api";
import { BackButton } from "@/components/back-button";
import { pushToast } from "@/components/toast";
import { useDismiss } from "@/components/dismiss";

type Service = { id: string; name: string; durationMin: number; price: number };
type Person = { id: string; name: string; phone: string };

const sources = ["פנייה ישירה לנועה", "מודעה ממומנת", "המלצה מלקוחה", "אינסטגרם אורגני", "אחר"];

type Existing = { id: string; contactId: string; contactName: string; serviceId: string; notes: string; durationMin: number; status?: string; ended?: boolean };
type Locked = { id: string; name: string; phone: string };

export function BookingDialog({ startsAt, onClose, onBooked, existing, lockContact, onOpenCard }: { startsAt: Date; onClose: () => void; onBooked: (contactId: string) => void; existing?: Existing; lockContact?: Locked; onOpenCard?: () => void }) {
  const [services, setServices] = useState<Service[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [serviceId, setServiceId] = useState(existing?.serviceId ?? "");
  const [when, setWhen] = useState(startsAt);
  const [month, setMonth] = useState(new Date(startsAt.getFullYear(), startsAt.getMonth(), 1));
  const [query, setQuery] = useState("");
  const [contactId, setContactId] = useState("");
  const [fresh, setFresh] = useState(false);
  const [busy, setBusy] = useState(false);
  const [attendance, setAttendance] = useState(existing?.status ?? "נקבע");
  const [mounted, setMounted] = useState(false);
  const { leaving, requestClose, onAnimationEnd } = useDismiss(onClose);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    api<{ services: Service[] }>("/settings").then((data) => {
      setServices(data.services);
      setServiceId((current) => current || data.services[0]?.id || "");
    }).catch((error: Error) => pushToast(error.message));
    api<{ items: Person[]; total: number }>("/contacts?kind=all&page=1").then(async (first) => {
      const pages = Math.ceil(first.total / 25);
      const rest = await Promise.all(Array.from({ length: Math.max(0, pages - 1) }, (_, index) => api<{ items: Person[] }>(`/contacts?kind=all&page=${index + 2}`)));
      setPeople([first, ...rest].flatMap((page) => page.items));
    }).catch(() => setPeople([]));
  }, []);

  function pickDay(day: Date) {
    const next = new Date(when);
    next.setFullYear(day.getFullYear(), day.getMonth(), day.getDate());
    setWhen(next);
  }

  function pickTime(hour: number, minute: number) {
    const next = new Date(when);
    next.setHours(hour, minute, 0, 0);
    setWhen(next);
  }

  const service = services.find((item) => item.id === serviceId);
  const minutes = existing && serviceId === existing.serviceId ? existing.durationMin : service?.durationMin;
  const end = minutes ? new Date(when.getTime() + minutes * 60000) : null;
  const fixed = existing ? { id: existing.contactId, name: existing.contactName } : lockContact ? { id: lockContact.id, name: lockContact.name } : null;
  const shown = useMemo(() => people.filter((person) => matchesPerson(person, query)).sort((a, b) => a.name.localeCompare(b.name, "he")), [people, query]);

  async function mark(status: "הגיעה" | "לא הגיעה") {
    if (!existing) return;
    setBusy(true);
    try {
      const saved = await api<{ becameClient?: boolean }>(`/appointments/${existing.id}/attendance`, { method: "POST", body: JSON.stringify({ status }) });
      setAttendance(status);
      pushToast(saved.becameClient ? "עברה ללקוחות" : "נשמר");
      requestClose(() => onBooked(existing.contactId));
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "לא הצלחנו");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!existing) return;
    if (!window.confirm("למחוק את התור?")) return;
    setBusy(true);
    try {
      await api(`/appointments/${existing.id}/cancel`, { method: "POST" });
      pushToast("נמחק");
      requestClose(() => onBooked(existing.contactId));
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "לא הצלחנו");
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      const data = new FormData(event.currentTarget);
      const notes = String(data.get("notes") ?? "");
      if (existing) {
        await api(`/appointments/${existing.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            startsAt: when.toISOString(),
            serviceId,
            notes,
            ...(serviceId === existing.serviceId ? { endsAt: new Date(when.getTime() + existing.durationMin * 60000).toISOString() } : {}),
          }),
        });
        pushToast("התור עודכן");
        requestClose(() => onBooked(existing.contactId));
        return;
      }
      let id = fixed?.id || contactId;
      if (fresh) {
        const created = await api<{ id: string }>("/contacts", {
          method: "POST",
          body: JSON.stringify({ name: data.get("name"), phone: data.get("phone"), source: data.get("source") }),
        });
        id = created.id;
      }
      if (!id) {
        pushToast("בחרי לקוחה או פתחי חדשה");
        return;
      }
      const booked = await api<{ becameClient?: boolean }>("/appointments", {
        method: "POST",
        body: JSON.stringify({
          contactId: id,
          serviceId,
          startsAt: when.toISOString(),
          notes,
        }),
      });
      pushToast(booked.becameClient ? "עברה ללקוחות" : "התור נקבע");
      requestClose(() => onBooked(id));
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "לא הצלחנו");
    } finally {
      setBusy(false);
    }
  }

  if (!mounted) return null;

  return createPortal(
    <>
      <button className={`drawer-bg book-layer${leaving ? " out" : ""}`} aria-label="סגירה" onClick={() => requestClose()} />
      <div className="book-layer pointer-events-none fixed inset-0 flex items-center justify-center p-4">
      <form onSubmit={submit} onAnimationEnd={onAnimationEnd} className={`glass has-back pointer-events-auto grid max-h-[min(100%,calc(100dvh-2rem))] w-[min(980px,100%)] grid-cols-1 gap-4 overflow-y-auto overscroll-contain rounded-xl p-4 sm:p-5 md:grid-cols-[minmax(0,1.25fr)_minmax(280px,0.75fr)] ${leaving ? "sheet-out" : "sheet-in"}`}>
        <BackButton onClick={() => requestClose()} />
        <div className="md:col-span-2">
          <p className="text-[12px] font-bold tracking-[0.16em] text-goldInk">{existing ? "עריכת תור" : "תור חדש"}</p>
          <h2 className="mt-1 text-2xl">{when.toLocaleString("he-IL", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}</h2>
        </div>
        <div className="min-w-0"><WhenPicker when={when} month={month} setMonth={setMonth} onDay={pickDay} onTime={pickTime} /></div>
        <div className="flex min-w-0 flex-col">
          <label className="block text-sm text-muted">שירות
            <select value={serviceId} onChange={(event) => setServiceId(event.target.value)} className="mt-1 w-full rounded-md border border-lineStrong bg-white/80 px-3 py-2 text-ink">
              {services.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.durationMin} דק׳ · {item.price}₪</option>)}
            </select>
          </label>
          {end ? <p className="mt-2 text-sm text-muted">נגמר ב־{end.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })}</p> : null}
          {fixed ? (
            <p className="mt-3 rounded-xl bg-white/75 px-3 py-2 font-bold">{fixed.name}</p>
          ) : (
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => setFresh(false)} className={`rounded-full px-3 py-1 ${fresh ? "bg-white/70" : "bg-brand text-onBrand"}`}>לקוחה קיימת</button>
            <button type="button" onClick={() => setFresh(true)} className={`rounded-full px-3 py-1 ${fresh ? "bg-brand text-onBrand" : "bg-white/70"}`}>לקוחה חדשה</button>
          </div>
          )}
          {fixed ? null : fresh ? (
            <div key="new-person" className="mt-3 space-y-2">
              <input name="name" required placeholder="שם" className="w-full rounded-md border border-lineStrong bg-white/80 px-3 py-2" />
              <input name="phone" required placeholder="טלפון" className="w-full rounded-md border border-lineStrong bg-white/80 px-3 py-2" />
              <select name="source" className="w-full rounded-md border border-lineStrong bg-white/80 px-3 py-2">
                {sources.map((item) => <option key={item}>{item}</option>)}
              </select>
            </div>
          ) : (
            <div key="find-person" className="mt-3">
              <input value={query ?? ""} onChange={(event) => setQuery(event.target.value)} placeholder="חיפוש שם או טלפון" className="w-full rounded-md border border-lineStrong bg-white/80 px-3 py-2" />
              <div className="mt-2 max-h-40 space-y-1 overflow-y-auto overscroll-contain pe-1">
                {shown.map((person) => (
                  <button type="button" key={person.id} onClick={() => setContactId(person.id)} className={`block w-full rounded-md px-3 py-1.5 text-right ${contactId === person.id ? "bg-brand text-onBrand" : "bg-white/70"}`}>
                    {person.name} · {person.phone}
                  </button>
                ))}
                {people.length === 0 ? <p className="text-sm text-muted">טוען</p> : shown.length === 0 ? <p className="text-sm text-muted">אין התאמה. אפשר לפתוח לקוחה חדשה.</p> : null}
              </div>
            </div>
          )}
          <textarea name="notes" defaultValue={existing?.notes ?? ""} placeholder="הערה לתור" className="mt-3 w-full rounded-md border border-lineStrong bg-white/80 p-2" rows={1} />
          {existing?.ended ? (
            <div className="mt-3 flex gap-2">
              <button type="button" disabled={busy} onClick={() => mark("הגיעה")} className={`rounded-full px-4 py-2 ${attendance === "הגיעה" ? "bg-[#3F6B3A] text-white" : "bg-[rgb(63_107_58/14%)] text-[#3F6B3A]"}`}>הגיעה</button>
              <button type="button" disabled={busy} onClick={() => mark("לא הגיעה")} className={`rounded-full px-4 py-2 ${attendance === "לא הגיעה" ? "bg-[#9B2F45] text-white" : "bg-[#F7E0E5] text-[#9B2F45]"}`}>לא הגיעה</button>
            </div>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <button disabled={busy} className="rounded-full bg-brand px-5 py-2 text-onBrand">{existing ? "שמירה" : "קביעה"}</button>
            {onOpenCard ? <button type="button" onClick={() => requestClose(onOpenCard)} className="rounded-full bg-white/80 px-5 py-2">פתיחת הכרטיס</button> : null}
            <button type="button" onClick={() => requestClose()} className="rounded-full bg-white/80 px-5 py-2">סגירה</button>
            {existing ? <button type="button" disabled={busy} onClick={remove} className="rounded-full bg-[#9B2F45] px-5 py-2 text-white">מחיקת התור</button> : null}
          </div>
        </div>
      </form>
      </div>
    </>,
    document.body,
  );
}

const weekdays = ["א", "ב", "ג", "ד", "ה", "ו", "ש"];
const times = Array.from({ length: 26 }, (_, index) => {
  const total = 8 * 60 + index * 30;
  return { hour: Math.floor(total / 60), minute: total % 60 };
});

function WhenPicker({ when, month, setMonth, onDay, onTime }: { when: Date; month: Date; setMonth: (value: Date) => void; onDay: (day: Date) => void; onTime: (hour: number, minute: number) => void }) {
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const first = new Date(year, monthIndex, 1).getDay();
  const count = new Date(year, monthIndex + 1, 0).getDate();
  const today = new Date();

  return (
    <div className="flex min-w-0 flex-col items-stretch gap-3 overflow-hidden rounded-xl bg-white/75 p-3 sm:flex-row sm:items-start">
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <button type="button" onClick={() => setMonth(new Date(year, monthIndex - 1, 1))} className="shrink-0 rounded-full bg-sunken px-3 py-1">הקודם</button>
          <p className="truncate font-bold">{month.toLocaleDateString("he-IL", { month: "long", year: "numeric" })}</p>
          <button type="button" onClick={() => setMonth(new Date(year, monthIndex + 1, 1))} className="shrink-0 rounded-full bg-sunken px-3 py-1">הבא</button>
        </div>
        <div className="mt-3 grid grid-cols-7 text-center text-xs text-faint">
          {weekdays.map((day) => <span key={day}>{day}</span>)}
        </div>
        <div className="mt-1 grid grid-cols-7 gap-1 text-center">
          {Array.from({ length: first }, (_, index) => <span key={`empty-${index}`} />)}
          {Array.from({ length: count }, (_, index) => {
            const day = new Date(year, monthIndex, index + 1);
            const selected = sameDay(day, when);
            const isToday = sameDay(day, today);
            return (
              <button key={day.toISOString()} type="button" onClick={() => onDay(day)} className={`mx-auto aspect-square w-full max-w-8 rounded-full text-sm ${selected ? "bg-brand text-onBrand" : isToday ? "bg-[#FBEFD5] text-goldInk" : "hover:bg-sunken"}`}>
                {index + 1}
              </button>
            );
          })}
        </div>
      </div>
      <div className="w-full shrink-0 sm:w-[9.5rem]">
        <p className="text-sm text-muted">שעה</p>
        <ExactTime when={when} onTime={onTime} />
        <div className="mt-2 grid grid-cols-4 gap-1 sm:grid-cols-2">
          {times.map((slot) => {
            const selected = when.getHours() === slot.hour && when.getMinutes() === slot.minute;
            const label = `${String(slot.hour).padStart(2, "0")}:${String(slot.minute).padStart(2, "0")}`;
            return (
              <button key={label} type="button" onClick={() => onTime(slot.hour, slot.minute)} className={`rounded-full py-2 text-sm sm:py-1 sm:text-[11px] ${selected ? "bg-brand text-onBrand" : "bg-sunken hover:bg-[#E4D3C0]"}`}>
                {label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ExactTime({ when, onTime }: { when: Date; onTime: (hour: number, minute: number) => void }) {
  const onGrid = times.some((slot) => slot.hour === when.getHours() && slot.minute === when.getMinutes());
  return (
    <div dir="ltr" className={`mt-2 flex items-center justify-center gap-1 rounded-full border bg-white px-2 py-1.5 ${onGrid ? "border-line" : "border-brand"}`}>
      <ClockPart label="שעות" value={when.getHours()} max={23} onCommit={(hour) => onTime(hour, when.getMinutes())} />
      <span className="font-bold text-brand">:</span>
      <ClockPart label="דקות" value={when.getMinutes()} max={59} onCommit={(minute) => onTime(when.getHours(), minute)} />
    </div>
  );
}

function ClockPart({ label, value, max, onCommit }: { label: string; value: number; max: number; onCommit: (next: number) => void }) {
  const [text, setText] = useState(pad(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setText(pad(value)); }, [value, focused]);

  function commit(raw: string) {
    if (raw === "") return;
    onCommit(Math.min(max, Math.max(0, Number(raw))));
  }

  return (
    <input
      aria-label={label}
      inputMode="numeric"
      value={focused ? text : pad(value)}
      onFocus={(event) => { setFocused(true); setText(pad(value)); event.currentTarget.select(); }}
      onBlur={() => { setFocused(false); commit(text); }}
      onChange={(event) => {
        const raw = event.target.value.replace(/\D/g, "").slice(0, 2);
        setText(raw);
        if (raw.length === 2) commit(raw);
      }}
      className="w-8 bg-transparent text-center text-sm font-bold text-brand outline-none"
    />
  );
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function matchesPerson(person: Person, query: string) {
  const text = query.trim();
  if (!text) return true;
  if (person.name.includes(text)) return true;
  const digits = text.replace(/\D/g, "");
  if (digits.length < 2) return false;
  const phone = person.phone.replace(/\D/g, "");
  const needle = digits.replace(/^972/, "").replace(/^0/, "");
  return phone.includes(digits) || phone.replace(/^0/, "").includes(needle);
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
