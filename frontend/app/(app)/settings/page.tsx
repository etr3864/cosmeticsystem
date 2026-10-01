"use client";

import { useEffect, useRef, useState } from "react";
import { BookOpen, CalendarDays, ChevronDown, Clock, Coins, MessageSquare, Wallet } from "lucide-react";
import { api } from "@/lib/api";
import { pushToast } from "@/components/toast";
import { SettingsApiGuide } from "@/components/settings-api-guide";

const days = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
const templates: Record<string, { title: string; when: string }> = {
  became_regular: { title: "הפכה לקבועה", when: "פעם אחת, בביקור השלישי. יש בו קישור לדף שלה, כדי שתשלח לחברה." },
  beshvilech: { title: "בשבילך", when: "20 דקות לפני תור לק ג'ל, אם עוד לא מילאו את הדף יחד. אין את זה בטיפולי פנים." },
  discount: { title: "הנחה אחרי הגעה", when: "מיד אחרי שסומנים הגיעה. ההנחה חיה 24 שעות, והקישור פותח שעות עם המחיר המוזל." },
  no_answer_3: { title: "אין מענה 3", when: "כשמעבירים לאין מענה 3. אחר כך הסטטוס הופך ללא רלוונטית." },
  no_show: { title: "לא הגיעה", when: "כשמסמנים לא הגיעה, או שעתיים אחרי סוף התור אם עוד לא סומן." },
  partner_link: { title: "קישור שותפים", when: "שליחה ידנית מהכרטיס. אותו הסבר כמו לקבועה, בלי «מעכשיו את קבועה»." },
};

const tabs = [
  { id: "hours", label: "שעות", hint: "מתי הקליניקה פתוחה", icon: Clock },
  { id: "prices", label: "מחירון", hint: "ברירת מחדל לכל שירות", icon: Coins },
  { id: "budget", label: "תקציב", hint: "הוצאה שיווקית לפי חודש", icon: Wallet },
  { id: "messages", label: "הודעות", hint: "הטקסטים שנשלחים", icon: MessageSquare },
  { id: "calendar", label: "יומן גוגל", hint: "היומן של נועה", icon: CalendarDays },
  { id: "guide", label: "מדריכים", hint: "טוקן וה־API לשירה", icon: BookOpen },
] as const;

type Tab = (typeof tabs)[number]["id"];

type Settings = {
  settings: { markedWeek?: Record<string, { start: string; end: string } | null>; clinic?: { address: string; unit: string; parking: string }; googleCalendarId?: string };
  automations: { key: string; messageTemplate: string; active: boolean }[];
  services: { id: string; name: string; price: number; durationMin: number }[];
  campaigns: { id: string; name: string; spend: { month: string; amount: number }[] }[];
  technical?: boolean;
  optiveHint?: string | null;
  googleHint?: string | null;
  apiBase?: string;
};

export default function SettingsPage() {
  const [data, setData] = useState<Settings | null>(null);
  const [week, setWeek] = useState<Record<string, { start: string; end: string } | null>>({});
  const [tab, setTab] = useState<Tab>("hours");
  const [openMessage, setOpenMessage] = useState<string | null>(null);
  const pane = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<Settings>("/settings").then((value) => {
      setData(value);
      setWeek(value.settings.markedWeek ?? {});
      setOpenMessage(value.automations[0]?.key ?? null);
    });
  }, []);

  useEffect(() => {
    pane.current?.scrollTo({ top: 0 });
  }, [tab]);

  async function saveHours() {
    await api("/settings/hours", { method: "PUT", body: JSON.stringify({ markedWeek: week }) });
    pushToast("נשמר");
  }

  return (
    <section className="flex h-full min-h-0 flex-col">
      <header className="mb-4 shrink-0">
        <h1 className="display-title text-[32px] leading-9 lg:text-[40px] lg:leading-10">הגדרות</h1>
      </header>
      <div className="glass flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl lg:flex-row">
        <nav className="flex shrink-0 gap-1 overflow-x-auto border-b border-line p-2 lg:w-56 lg:flex-col lg:overflow-visible lg:border-b-0 lg:border-e lg:p-3">
          {tabs.map((item) => {
            const Icon = item.icon;
            const on = tab === item.id;
            return (
              <button key={item.id} type="button" onClick={() => setTab(item.id)} className={`settings-still flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-right lg:w-full lg:gap-3 lg:py-3 ${on ? "bg-brand text-onBrand shadow-card" : "text-ink hover:bg-white/80"}`}>
                <Icon size={18} strokeWidth={1.75} />
                <span className="min-w-0">
                  <span className="block whitespace-nowrap font-bold">{item.label}</span>
                  <span className={`hidden text-xs lg:block ${on ? "text-onBrand/80" : "text-faint"}`}>{item.hint}</span>
                </span>
              </button>
            );
          })}
        </nav>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div ref={pane} className="min-h-0 flex-1 overflow-y-auto p-4 lg:p-6">
            {!data ? <p className="text-muted">טוען</p> : (
              <div key={tab} className="settings-pane">
                {tab === "hours" ? (
                  <>
                    <h2 className="text-2xl">שעות שנועה מסמנת</h2>
                    <p className="mt-1 text-muted">רק בתוך השעות האלה אפשר לקבוע תור. יום בלי סימון נשאר סגור.</p>
                    <div className="mt-4 space-y-2">
                      {days.map((label, index) => {
                        const value = week[String(index)];
                        return (
                          <div key={label} className="settings-row flex flex-wrap items-center gap-3 rounded-xl border border-line bg-white/75 px-3 py-2.5" style={{ animationDelay: `${index * 40}ms` }}>
                            <button type="button" aria-label={value ? `${label} פתוח` : `${label} סגור`} onClick={() => setWeek({ ...week, [index]: value ? null : { start: "09:00", end: "19:00" } })} className={`pick ${value ? "on" : ""}`}>{value ? "✓" : ""}</button>
                            <span className="w-16 font-bold">{label}</span>
                            {value ? (
                              <span className="flex flex-wrap items-center gap-2">
                                <TimeField label={`${label} פתיחה`} value={value.start} onChange={(start) => setWeek({ ...week, [index]: { ...value, start } })} />
                                <span className="text-faint">עד</span>
                                <TimeField label={`${label} סגירה`} value={value.end} onChange={(end) => setWeek({ ...week, [index]: { ...value, end } })} />
                              </span>
                            ) : <span className="text-muted">סגור</span>}
                          </div>
                        );
                      })}
                    </div>
                  </>
                ) : null}
                {tab === "prices" ? (
                  <>
                    <h2 className="text-2xl">מחירון</h2>
                    <p className="mt-1 text-muted">המחיר כאן הוא ברירת המחדל לתורים חדשים ולתורים שעוד לא נרשם בהם סכום. סכום שנשמר על תור נשאר כמו שהוא. זמן הטיפול חל על כל התורים של השירות, כולל תורים שכבר נקבעו.</p>
                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      {data.services.map((item, index) => (
                        <div key={item.id} className="settings-row rounded-xl border border-line bg-white/80 p-4" style={{ animationDelay: `${index * 50}ms` }}>
                          <span className="block text-lg">{item.name}</span>
                          <label className="mt-3 block text-sm text-muted">זמן טיפול
                            <span className="mt-1 flex items-center gap-2">
                              <input
                                type="number"
                                min={30}
                                aria-label={`זמן טיפול ${item.name}`}
                                defaultValue={item.durationMin}
                                key={`${item.id}-time-${item.durationMin}`}
                                onBlur={(event) => {
                                  const durationMin = Number(event.target.value);
                                  if (!Number.isInteger(durationMin) || durationMin < 30) {
                                    pushToast("זמן טיפול קצר מדי");
                                    event.target.value = String(item.durationMin);
                                    return;
                                  }
                                  if (durationMin === item.durationMin) return;
                                  api(`/settings/services/${item.id}`, { method: "PUT", body: JSON.stringify({ durationMin }) }).then(() => {
                                    setData((current) => current && { ...current, services: current.services.map((service) => service.id === item.id ? { ...service, durationMin } : service) });
                                    pushToast("נשמר");
                                  }).catch((error: Error) => pushToast(error.message));
                                }}
                                className="w-28 rounded-md border border-lineStrong bg-white px-3 py-2 text-ink"
                              />
                              <span className="text-goldInk">דק׳</span>
                            </span>
                          </label>
                          <label className="mt-3 block text-sm text-muted">מחיר
                          <span className="mt-1 flex items-center gap-2">
                            <input
                              type="number"
                              min={0}
                              aria-label={`מחיר ${item.name}`}
                              defaultValue={item.price}
                              key={`${item.id}-${item.price}`}
                              onBlur={(event) => {
                                const price = Number(event.target.value);
                                if (!Number.isInteger(price) || price < 0) {
                                  pushToast("סכום לא תקין");
                                  event.target.value = String(item.price);
                                  return;
                                }
                                if (price === item.price) return;
                                api(`/settings/services/${item.id}`, { method: "PUT", body: JSON.stringify({ price }) }).then(() => {
                                  setData((current) => current && { ...current, services: current.services.map((service) => service.id === item.id ? { ...service, price } : service) });
                                  pushToast("נשמר");
                                }).catch((error: Error) => pushToast(error.message));
                              }}
                              className="w-28 rounded-md border border-lineStrong bg-white px-3 py-2 text-ink"
                            />
                            <span className="text-goldInk">₪</span>
                          </span>
                          </label>
                        </div>
                      ))}
                    </div>
                  </>
                ) : null}
                {tab === "budget" ? <Budget campaigns={data.campaigns} onSaved={(campaigns) => setData((current) => current && { ...current, campaigns })} /> : null}
                {tab === "messages" ? (
                  <>
                    <h2 className="text-2xl">הודעות</h2>
                    <p className="mt-1 text-muted">מתג כבוי עוצר את השליחה, גם להודעה שכבר נקבעה. שינוי ניסוח חל על הודעות שעוד לא יצאו.</p>
                    <OptiveKey hint={data.optiveHint ?? null} onSaved={(optiveHint) => setData((current) => current && { ...current, optiveHint })} />
                    <div className="mt-4 space-y-2">
                      {data.automations.map((item, index) => {
                        const meta = templates[item.key] ?? { title: item.key, when: "" };
                        const open = openMessage === item.key;
                        return (
                          <article key={item.key} className="settings-row overflow-hidden rounded-xl border border-line bg-white/80" style={{ animationDelay: `${index * 40}ms` }}>
                            <div className="flex items-center gap-3 px-4 py-3">
                              <button type="button" onClick={() => setOpenMessage(open ? null : item.key)} className="settings-still flex min-w-0 flex-1 items-center justify-between gap-3 text-right hover:opacity-80">
                                <span className="min-w-0">
                                  <span className={`block text-lg ${item.active ? "" : "text-muted"}`}>{meta.title}</span>
                                  <span className="mt-0.5 block text-sm text-muted">{meta.when}</span>
                                </span>
                                <ChevronDown size={18} className={`shrink-0 text-goldInk transition ${open ? "rotate-180" : ""}`} />
                              </button>
                              <SendSwitch
                                on={item.active}
                                label={meta.title}
                                onToggle={() => {
                                  const active = !item.active;
                                  setData((current) => current && { ...current, automations: current.automations.map((row) => row.key === item.key ? { ...row, active } : row) });
                                  api(`/settings/automations/${item.key}`, { method: "PUT", body: JSON.stringify({ active }) }).then(() => {
                                    pushToast(active ? "השליחה דולקת" : "השליחה כבויה");
                                  }).catch((error: Error) => {
                                    setData((current) => current && { ...current, automations: current.automations.map((row) => row.key === item.key ? { ...row, active: item.active } : row) });
                                    pushToast(error.message);
                                  });
                                }}
                              />
                            </div>
                            {open ? (
                              <div className="border-t border-line px-4 py-3">
                                <textarea
                                  aria-label={meta.title}
                                  defaultValue={item.messageTemplate}
                                  onBlur={(event) => {
                                    if (event.target.value === item.messageTemplate) return;
                                    api(`/settings/automations/${item.key}`, { method: "PUT", body: JSON.stringify({ messageTemplate: event.target.value }) }).then(() => {
                                      setData((current) => current && { ...current, automations: current.automations.map((row) => row.key === item.key ? { ...row, messageTemplate: event.target.value } : row) });
                                      pushToast("נשמר");
                                    }).catch((error: Error) => pushToast(error.message));
                                  }}
                                  className="w-full rounded-md border border-lineStrong bg-white p-3 text-ink"
                                  rows={5}
                                />
                              </div>
                            ) : null}
                          </article>
                        );
                      })}
                    </div>
                  </>
                ) : null}
                {tab === "calendar" ? (
                  <GoogleLink
                    hint={data.googleHint ?? null}
                    calendarId={typeof data.settings.googleCalendarId === "string" ? data.settings.googleCalendarId : ""}
                    onSaved={(googleHint, calendarId) => setData((current) => current && {
                      ...current,
                      googleHint,
                      settings: { ...current.settings, googleCalendarId: calendarId },
                    })}
                  />
                ) : null}
                {tab === "guide" ? <SettingsApiGuide apiBase={data.apiBase ?? "http://localhost:3000/backend"} /> : null}
              </div>
            )}
          </div>
          {tab === "hours" && data ? (
            <div className="shrink-0 border-t border-line px-6 py-4">
              <button type="button" onClick={saveHours} className="rounded-full bg-brand px-5 py-2 text-onBrand">שמירת שעות</button>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

const monthNames = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];

function MonthPick({ value, onChange }: { value: string; onChange: (month: string) => void }) {
  const [yearText, part] = value.split("-");
  const year = Number(yearText);
  const selected = Number(part);

  function choose(nextYear: number, nextMonth: number) {
    onChange(`${nextYear}-${String(nextMonth).padStart(2, "0")}`);
  }

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between">
        <button type="button" aria-label="שנה קודמת" onClick={() => choose(year - 1, selected)} className="settings-still grid h-9 w-9 place-items-center rounded-[10px] border border-line bg-white text-muted">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"><path d="m9 18 6-6-6-6" /></svg>
        </button>
        <span className="text-lg font-bold text-ink">{year}</span>
        <button type="button" aria-label="שנה הבאה" onClick={() => choose(year + 1, selected)} className="settings-still grid h-9 w-9 place-items-center rounded-[10px] border border-line bg-white text-muted">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"><path d="m15 18-6-6 6-6" /></svg>
        </button>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
        {monthNames.map((name, index) => {
          const on = index + 1 === selected;
          return (
            <button key={name} type="button" onClick={() => choose(year, index + 1)} className={`rounded-full px-2 py-2 text-sm ${on ? "bg-brand font-bold text-onBrand" : "bg-sunken text-ink"}`}>{name}</button>
          );
        })}
      </div>
    </div>
  );
}

function monthKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(month: string) {
  const [year, part] = month.split("-").map(Number);
  return new Date(year, part - 1, 1).toLocaleDateString("he-IL", { month: "long", year: "numeric" });
}

function monthsOf(campaigns: Settings["campaigns"]) {
  const totals = new Map<string, number>();
  for (const campaign of campaigns) {
    for (const row of campaign.spend) totals.set(row.month, (totals.get(row.month) ?? 0) + row.amount);
  }
  return [...totals.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([month, amount]) => ({ month, amount }));
}

function Budget({ campaigns, onSaved }: { campaigns: Settings["campaigns"]; onSaved: (campaigns: Settings["campaigns"]) => void }) {
  const rows = monthsOf(campaigns);
  const [month, setMonth] = useState(monthKey);
  const [amount, setAmount] = useState("");
  const known = rows.some((row) => row.month === month);

  async function save(nextMonth: string, nextAmount: number) {
    const result = await api<{ campaigns: Settings["campaigns"] }>("/settings/budget", {
      method: "PUT",
      body: JSON.stringify({ month: nextMonth, amount: nextAmount }),
    });
    onSaved(result.campaigns);
    pushToast("נשמר");
  }

  return (
    <>
      <h2 className="text-2xl">תקציב שיווק</h2>
      <p className="mt-1 text-muted">הסכום של כל חודש הוא ההוצאה בדשבורד. ממנו מחושבות עלות לליד ועלות ללקוחה.</p>
      {rows.length === 0 ? <p className="mt-4 text-muted">עוד אין תקציב. מוסיפים חודש וסכום.</p> : (
        <div className="mt-4 space-y-2">
          {rows.map((row, index) => (
            <div key={row.month} className="settings-row flex items-center justify-between gap-3 rounded-xl border border-line bg-white/75 px-4 py-3" style={{ animationDelay: `${index * 40}ms` }}>
              <span className="font-bold">{monthLabel(row.month)}</span>
              <label className="flex items-center gap-2 text-sm text-muted">
                <input
                  type="number"
                  min={0}
                  aria-label={`תקציב ${monthLabel(row.month)}`}
                  defaultValue={row.amount}
                  key={`${row.month}-${row.amount}`}
                  onBlur={(event) => {
                    const value = Number(event.target.value);
                    if (!Number.isInteger(value) || value < 0) {
                      pushToast("סכום לא תקין");
                      event.target.value = String(row.amount);
                      return;
                    }
                    if (value === row.amount) return;
                    save(row.month, value).catch((error: Error) => pushToast(error.message));
                  }}
                  className="w-28 rounded-md border border-lineStrong bg-white px-3 py-2 text-ink"
                />
                <span className="text-goldInk">₪</span>
              </label>
            </div>
          ))}
        </div>
      )}
      <form
        className="mt-4 rounded-xl border border-line bg-white/80 p-4"
        onSubmit={(event) => {
          event.preventDefault();
          const value = Number(amount);
          if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !Number.isInteger(value) || value < 0) {
            pushToast("סכום לא תקין");
            return;
          }
          save(month, value).then(() => setAmount("")).catch((error: Error) => pushToast(error.message));
        }}
      >
        <p className="text-sm text-muted">חודש</p>
        <MonthPick value={month} onChange={setMonth} />
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="text-sm text-muted">סכום
            <input value={amount} onChange={(event) => setAmount(event.target.value.replace(/\D/g, ""))} inputMode="numeric" required placeholder="0" className="mt-1 block w-28 rounded-md border border-lineStrong bg-white px-3 py-2 text-ink" />
          </label>
          <button className="rounded-full bg-brand px-5 py-2 text-onBrand">{known ? "עדכון החודש" : "הוספת חודש"}</button>
        </div>
      </form>
    </>
  );
}

function TimeField({ label, value, onChange }: { label: string; value: string; onChange: (next: string) => void }) {
  const [hour, minute] = value.split(":");
  return (
    <span dir="ltr" className="inline-flex items-center gap-1 rounded-full border border-line bg-white px-2 py-1">
      <ClockPart label={`${label}, שעות`} value={Number(hour)} max={23} onCommit={(next) => onChange(`${pad(next)}:${minute}`)} />
      <span className="font-bold text-brand">:</span>
      <ClockPart label={`${label}, דקות`} value={Number(minute)} max={59} onCommit={(next) => onChange(`${hour}:${pad(next)}`)} />
    </span>
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

function SendSwitch({ on, label, onToggle }: { on: boolean; label: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      dir="ltr"
      aria-checked={on}
      aria-label={`${label}, ${on ? "דולק" : "כבוי"}`}
      onClick={onToggle}
      className="settings-still flex shrink-0 items-center gap-2"
    >
      <span className={`w-8 text-xs font-bold ${on ? "text-goldInk" : "text-faint"}`}>{on ? "דולק" : "כבוי"}</span>
      <span className={`relative h-8 w-14 rounded-full border transition duration-200 ${on ? "border-brand bg-brand" : "border-lineStrong bg-white"}`}>
        <span className={`absolute top-1 h-6 w-6 rounded-full shadow-sm transition duration-200 ${on ? "left-7 bg-[#F1C968]" : "left-1 bg-[#D6C6B3]"}`} />
      </span>
    </button>
  );
}

function GoogleLink({ hint, calendarId, onSaved }: { hint: string | null; calendarId: string; onSaved: (hint: string | null, calendarId: string) => void }) {
  const [email, setEmail] = useState(calendarId);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const next = email.trim();
        if (!next) return;
        setBusy(true);
        api<{ googleHint: string | null }>("/settings/google", {
          method: "PUT",
          body: JSON.stringify({ calendarId: next, ...(key.trim() ? { key } : {}) }),
        })
          .then((saved) => {
            onSaved(saved.googleHint ?? hint, next);
            setKey("");
            pushToast("נשמר");
          })
          .catch((error: Error) => pushToast(error.message))
          .finally(() => setBusy(false));
      }}
    >
      <h2 className="text-2xl">יומן גוגל</h2>
      <p className="mt-1 text-muted">תור שנקבע כאן נכתב ליומן של נועה. תור שהיא מוסיפה בגוגל נכנס לכאן כשיש בכותרת [NT:טלפון], למשל לק ג׳ל [NT:0521234567]. אירוע בלי טלפון נשאר בגוגל.</p>
      <p className="mt-3 text-sm">{hint ? `מחובר עם ${hint}` : "עוד אין מפתח."}</p>
      <label className="mt-4 block text-sm text-muted">כתובת היומן
        <input
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="המייל של היומן"
          className="mt-1 w-full rounded-md border border-lineStrong bg-white px-3 py-2 text-ink"
        />
      </label>
      <p className="mt-2 text-sm text-muted">משתפים את היומן עם כתובת חשבון השירות, עם הרשאה לערוך אירועים.</p>
      <label className="mt-3 block text-sm text-muted">מפתח JSON
        <textarea
          value={key}
          onChange={(event) => setKey(event.target.value)}
          placeholder="מדביקים את הקובץ פעם אחת"
          className="mt-1 w-full rounded-md border border-lineStrong bg-white p-3 text-ink"
          rows={4}
        />
      </label>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="submit" disabled={busy || !email.trim()} className="rounded-full bg-brand px-5 py-2 text-onBrand">שמירה</button>
        <button
          type="button"
          disabled={busy || !hint}
          onClick={() => {
            setBusy(true);
            api("/settings/google/test", { method: "POST" })
              .then(() => pushToast("היומן נפתח"))
              .catch((error: Error) => pushToast(error.message))
              .finally(() => setBusy(false));
          }}
          className="rounded-full bg-white px-5 py-2"
        >בדיקת חיבור</button>
      </div>
    </form>
  );
}

function OptiveKey({ hint, onSaved }: { hint: string | null; onSaved: (hint: string) => void }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="mt-4 rounded-xl border border-line bg-white/80 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        const next = value.trim();
        if (!next) return;
        setBusy(true);
        api("/settings/secret", { method: "PUT", body: JSON.stringify({ key: "optive_api_key", value: next }) })
          .then(() => {
            onSaved(next.slice(-4));
            setValue("");
            pushToast("נשמר");
          })
          .catch((error: Error) => pushToast(error.message))
          .finally(() => setBusy(false));
      }}
    >
      <h3 className="text-lg">מפתח השליחה</h3>
      <p className="mt-1 text-sm text-muted">המפתח של אופטיב. איתו ההודעות יוצאות מהמספר של שירה.</p>
      <p className="mt-3 text-sm">{hint ? `שמור, מסתיים ב־${hint}` : "עוד אין מפתח."}</p>
      <label className="mt-3 block text-sm text-muted">מפתח חדש
        <input
          type="password"
          autoComplete="off"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="מדביקים כאן"
          className="mt-1 w-full rounded-md border border-lineStrong bg-white px-3 py-2 text-ink"
        />
      </label>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="submit" disabled={busy || !value.trim()} className="rounded-full bg-brand px-5 py-2 text-onBrand">שמירה</button>
        <button
          type="button"
          disabled={busy || !hint}
          onClick={() => {
            setBusy(true);
            api("/settings/optive/test", { method: "POST" })
              .then(() => pushToast("החיבור תקין"))
              .catch((error: Error) => pushToast(error.message))
              .finally(() => setBusy(false));
          }}
          className="rounded-full bg-white px-5 py-2"
        >בדיקת חיבור</button>
      </div>
    </form>
  );
}
