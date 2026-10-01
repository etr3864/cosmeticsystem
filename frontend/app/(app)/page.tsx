"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useDismiss } from "@/components/dismiss";

type Dash = {
  income: number;
  marketing: { leads: number; spend: number; cpl: number; cac: number };
  sales: { booked: number; arrived: number; leadToBook: number; leadToArrive: number };
  operations: { arrived: number; noShow: number; showRate: number; atRisk: number; dormant: number };
  clients: { active: number; regulars: number; credits: number };
};

const presets = [
  ["today", "היום"],
  ["week", "השבוע"],
  ["month", "החודש"],
  ["prev", "החודש הקודם"],
  ["quarter", "3 חודשים"],
] as const;

type Preset = (typeof presets)[number][0] | "custom";

export default function HomePage() {
  const [preset, setPreset] = useState<Preset>("month");
  const [from, setFrom] = useState(dayInput(startOfMonth(new Date())));
  const [to, setTo] = useState(dayInput(new Date()));
  const [data, setData] = useState<Dash | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const start = new Date(`${from}T00:00:00`);
    const end = new Date(`${to}T23:59:59`);
    api<Dash>(`/dashboard?from=${start.toISOString()}&to=${end.toISOString()}`)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [from, to]);

  function choose(next: Exclude<Preset, "custom">) {
    const [start, end] = rangeFor(next);
    setPreset(next);
    setFrom(dayInput(start));
    setTo(dayInput(end));
  }

  const show = data?.operations.showRate ?? 0;
  return (
    <section className="h-full overflow-auto">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="display-title text-[32px] leading-9 lg:text-[40px] lg:leading-10">ראשי</h1>
          <p className="text-muted">{labelRange(from, to)}</p>
        </div>
        <RangePicker preset={preset} from={from} to={to} onPreset={choose} onRange={(start, end) => { setPreset("custom"); setFrom(dayInput(start)); setTo(dayInput(end)); }} />
      </div>
      {loading || !data ? <DashSkeleton /> : (
        <>
          <article className="dash-card hero glass mb-5 grid gap-6 rounded-xl p-4 sm:p-6 md:grid-cols-[1.3fr_1fr]">
            <div>
              <p className="text-[12px] font-bold tracking-[0.18em] text-goldInk">הכנסה</p>
              <p className="count-up mt-2 font-sans text-[44px] font-bold leading-none sm:text-[64px]"><Count value={`₪${data.income}`} /></p>
              <p className="mt-3 text-muted">{data.operations.arrived} הגיעו · {data.operations.noShow} לא הגיעו</p>
            </div>
            <div>
              <p className="text-[12px] font-bold tracking-[0.18em] text-goldInk">אחוז הגעה</p>
              <p className="count-up mt-2 text-[40px] font-bold"><Count value={`${show}%`} /></p>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/70">
                <div className="dash-bar" style={{ ["--w" as string]: `${show}%` }} />
              </div>
            </div>
          </article>
          <div className="grid gap-4 lg:grid-cols-3">
            <Panel delay={90} title="שיווק" tiles={[
              ["לידים", data.marketing.leads],
              ["הוצאה", `₪${data.marketing.spend}`],
              ["עלות לליד", `₪${data.marketing.cpl}`],
              ["עלות ללקוחה", `₪${data.marketing.cac}`],
            ]} />
            <Panel delay={160} title="מכירות" tiles={[
              ["נקבע תור", data.sales.booked],
              ["הגיעו מהלידים", data.sales.arrived],
              ["ליד לתור", `${data.sales.leadToBook}%`],
              ["ליד להגעה", `${data.sales.leadToArrive}%`],
            ]} />
            <Panel delay={230} title="תפעול" tiles={[
              ["בסיכון", data.operations.atRisk],
              ["רדומות", data.operations.dormant],
              ["פעילות", data.clients.active],
              ["קבועות", data.clients.regulars],
            ]} />
          </div>
        </>
      )}
    </section>
  );
}

function Count({ value }: { value: string | number }) {
  const text = String(value);
  const match = text.match(/^(.*?)(\d+)(.*)$/);
  const target = match ? Number(match[2]) : 0;
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (!match) return;
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / 900);
      setShown(Math.round(target * (1 - Math.pow(1 - progress, 3))));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [text]);
  if (!match) return <>{text}</>;
  return <>{match[1]}{shown}{match[3]}</>;
}

function Panel({ title, tiles, delay }: { title: string; tiles: [string, string | number][]; delay: number }) {
  return (
    <article className="dash-card glass rounded-xl p-5" style={{ animationDelay: `${delay}ms` }}>
      <p className="text-[12px] font-bold tracking-[0.16em] text-goldInk">{title}</p>
      <div className="gold-rule my-3" />
      <div className="grid grid-cols-2 gap-2">
        {tiles.map(([label, value]) => (
          <div key={label} className="stat rounded-xl bg-white/80 px-3 py-3">
            <p className="count-up text-[28px] font-bold leading-none" style={{ animationDelay: `${delay}ms` }}><Count value={value} /></p>
            <p className="mt-1 text-sm text-muted">{label}</p>
          </div>
        ))}
      </div>
    </article>
  );
}

function RangePicker({ preset, from, to, onPreset, onRange }: { preset: Preset; from: string; to: string; onPreset: (next: Exclude<Preset, "custom">) => void; onRange: (start: Date, end: Date) => void }) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState(() => startOfMonth(new Date()));
  const [start, setStart] = useState<Date | null>(null);
  const [hover, setHover] = useState<Date | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const openRef = useRef(false);
  const { leaving, requestClose, onAnimationEnd } = useDismiss(() => setOpen(false));
  const closeRef = useRef(requestClose);
  openRef.current = open;
  closeRef.current = requestClose;

  useEffect(() => {
    function onDown(event: MouseEvent) {
      if (!openRef.current || box.current?.contains(event.target as Node)) return;
      closeRef.current();
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  function pickDay(day: Date) {
    if (!start) {
      setStart(day);
      return;
    }
    const [fromDay, toDay] = day < start ? [day, start] : [start, day];
    onRange(fromDay, toDay);
    setStart(null);
    requestClose();
  }

  const right = anchor;
  const left = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1);

  return (
    <div ref={box} className="relative">
      <div className="flex max-w-full flex-wrap items-center gap-0.5 rounded-[14px] border border-line bg-[#F5EFE7] p-1">
        {presets.map(([id, label]) => (
          <button key={id} type="button" onClick={() => { onPreset(id); if (open) requestClose(); }} className={`h-9 rounded-[10px] px-3.5 text-sm ${preset === id ? "bg-brand font-bold text-onBrand" : "text-muted"}`}>{label}</button>
        ))}
        <button type="button" onClick={() => open ? requestClose() : setOpen(true)} className={`flex h-9 items-center gap-1.5 rounded-[10px] px-3.5 text-sm ${preset === "custom" || open ? "bg-[#F3EAE0] font-bold text-brand" : "text-muted"}`}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true"><path d="M8 2v3M16 2v3" /><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18" /></svg>
          טווח חופשי
        </button>
      </div>
      {open ? (
        <div onAnimationEnd={onAnimationEnd} className={`range-pop absolute left-0 top-[calc(100%+8px)] z-30 flex overflow-hidden rounded-[20px] border border-line bg-white shadow-[0_16px_40px_-8px_rgba(62,31,8,0.16)] ${leaving ? "pop-out" : "pop-in"}`}>
          <div className="range-side flex w-40 shrink-0 flex-col gap-0.5 border-e border-line bg-[#FBF8F4] p-4">
            {presets.map(([id, label]) => (
              <button key={id} type="button" onClick={() => { onPreset(id); requestClose(); }} className={`h-10 rounded-[10px] px-3 text-right text-sm ${preset === id ? "bg-[#F3EAE0] font-bold text-brand" : "text-muted"}`}>{label}</button>
            ))}
            <button type="button" className="h-10 rounded-[10px] bg-[#F3EAE0] px-3 text-right text-sm font-bold text-brand">טווח חופשי</button>
          </div>
          <div className="flex min-w-0 flex-col gap-4 px-6 py-5">
            <div className="flex items-center justify-between">
              <button type="button" aria-label="חודש קודם" onClick={() => setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1))} className="grid h-9 w-9 place-items-center rounded-[10px] border border-line bg-white text-muted">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"><path d="m9 18 6-6-6-6" /></svg>
              </button>
              <button type="button" aria-label="חודש הבא" onClick={() => setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1))} className="grid h-9 w-9 place-items-center rounded-[10px] border border-line bg-white text-muted">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"><path d="m15 18-6-6 6-6" /></svg>
              </button>
            </div>
            <div className="range-months" onMouseLeave={() => setHover(null)}>
              <MonthGrid month={right} from={from} to={to} pending={start} hover={hover} onPick={pickDay} onHover={setHover} />
              <MonthGrid month={left} from={from} to={to} pending={start} hover={hover} onPick={pickDay} onHover={setHover} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const weekdays = ["א", "ב", "ג", "ד", "ה", "ו", "ש"];

function MonthGrid({ month, from, to, pending, hover, onPick, onHover }: { month: Date; from: string; to: string; pending: Date | null; hover: Date | null; onPick: (day: Date) => void; onHover: (day: Date) => void }) {
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const lead = new Date(year, monthIndex, 1).getDay();
  const count = new Date(year, monthIndex + 1, 0).getDate();
  const [start, end] = span(pending, hover, from, to);

  return (
    <div className="w-[240px] max-w-full">
      <p className="text-center font-bold">{month.toLocaleDateString("he-IL", { month: "long", year: "numeric" })}</p>
      <div className="mt-2 grid grid-cols-7 text-center text-xs font-bold text-faint">
        {weekdays.map((day) => <span key={day}>{day}</span>)}
      </div>
      <div className="mt-1 grid grid-cols-7">
        {Array.from({ length: lead }, (_, index) => <span key={`empty-${index}`} />)}
        {Array.from({ length: count }, (_, index) => {
          const day = new Date(year, monthIndex, index + 1);
          const role = dayRole(day, start, end);
          return (
            <button key={day.toISOString()} type="button" onMouseEnter={() => onHover(day)} onClick={() => onPick(day)} className={`grid h-9 place-items-center text-sm tabular-nums ${role === "edge" ? "rounded-[10px] bg-brand font-bold text-onBrand" : role === "mid" ? "bg-[#F3EAE0] text-brand" : "rounded-[10px] text-ink"}`}>{index + 1}</button>
          );
        })}
      </div>
    </div>
  );
}

function span(pending: Date | null, hover: Date | null, from: string, to: string): [Date, Date | null] {
  if (pending && hover) {
    return hover < pending ? [hover, pending] : [pending, hover];
  }
  if (pending) return [pending, null];
  return [parseDay(from), parseDay(to)];
}

function dayRole(day: Date, start: Date, end: Date | null) {
  const key = dayInput(day);
  if (key === dayInput(start) || (end && key === dayInput(end))) return "edge";
  if (end && day > start && day < end) return "mid";
  return "";
}

function DashSkeleton() {
  return (
    <div aria-busy="true" aria-label="טוען נתונים">
      <div className="skeleton mb-5 h-40 rounded-xl" />
      <div className="grid gap-4 lg:grid-cols-3">
        {[0, 1, 2].map((panel) => (
          <div key={panel} className="rounded-xl border border-line bg-white/70 p-5">
            <div className="skeleton mb-4 h-3 w-16 rounded-full" />
            <div className="grid grid-cols-2 gap-2">
              {[0, 1, 2, 3].map((tile) => <div key={tile} className="skeleton h-[72px] rounded-xl" />)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function startOfWeek(date: Date) {
  const next = new Date(date);
  next.setDate(date.getDate() - date.getDay());
  return next;
}

function rangeFor(preset: Exclude<Preset, "custom">, now = new Date()): [Date, Date] {
  if (preset === "today") return [now, now];
  if (preset === "week") return [startOfWeek(now), now];
  if (preset === "month") return [startOfMonth(now), now];
  if (preset === "prev") return [new Date(now.getFullYear(), now.getMonth() - 1, 1), new Date(now.getFullYear(), now.getMonth(), 0)];
  return [new Date(now.getFullYear(), now.getMonth() - 2, 1), now];
}

function dayInput(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseDay(value: string) {
  return new Date(`${value}T00:00:00`);
}

function labelRange(from: string, to: string) {
  const style: Intl.DateTimeFormatOptions = { day: "numeric", month: "long" };
  return `${new Date(`${from}T00:00:00`).toLocaleDateString("he-IL", style)} – ${new Date(`${to}T00:00:00`).toLocaleDateString("he-IL", style)}`;
}
