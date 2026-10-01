"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarDays, ChevronDown, Clock, Coins, MessageSquare } from "lucide-react";
import { api } from "@/lib/api";
import { pushToast } from "@/components/toast";

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
  { id: "messages", label: "הודעות", hint: "הטקסטים שנשלחים", icon: MessageSquare },
  { id: "calendar", label: "יומן גוגל", hint: "כותרות לבדיקה", icon: CalendarDays },
] as const;

type Tab = (typeof tabs)[number]["id"];

type Settings = {
  settings: { markedWeek?: Record<string, { start: string; end: string } | null>; clinic?: { address: string; unit: string; parking: string } };
  automations: { key: string; messageTemplate: string; active: boolean }[];
  services: { id: string; name: string; price: number; durationMin: number }[];
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
        <h1 className="display-title text-[40px] leading-10">הגדרות</h1>
      </header>
      <div className="glass flex min-h-0 flex-1 overflow-hidden rounded-xl">
        <nav className="flex w-56 shrink-0 flex-col gap-1 border-e border-line p-3">
          {tabs.map((item) => {
            const Icon = item.icon;
            const on = tab === item.id;
            return (
              <button key={item.id} type="button" onClick={() => setTab(item.id)} className={`settings-still flex items-center gap-3 rounded-xl px-3 py-3 text-right ${on ? "bg-brand text-onBrand shadow-card" : "text-ink hover:bg-white/80"}`}>
                <Icon size={18} strokeWidth={1.75} />
                <span className="min-w-0">
                  <span className="block font-bold">{item.label}</span>
                  <span className={`block text-xs ${on ? "text-onBrand/80" : "text-faint"}`}>{item.hint}</span>
                </span>
              </button>
            );
          })}
        </nav>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div ref={pane} className="min-h-0 flex-1 overflow-y-auto p-6">
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
                          <div key={label} className="settings-row flex items-center gap-3 rounded-xl border border-line bg-white/75 px-3 py-2.5" style={{ animationDelay: `${index * 40}ms` }}>
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
                {tab === "messages" ? (
                  <>
                    <h2 className="text-2xl">הודעות</h2>
                    <p className="mt-1 text-muted">שינוי חל רק על הודעות שעוד לא נקבעו לשליחה.</p>
                    <div className="mt-4 space-y-2">
                      {data.automations.map((item, index) => {
                        const meta = templates[item.key] ?? { title: item.key, when: "" };
                        const open = openMessage === item.key;
                        return (
                          <article key={item.key} className="settings-row overflow-hidden rounded-xl border border-line bg-white/80" style={{ animationDelay: `${index * 40}ms` }}>
                            <button type="button" onClick={() => setOpenMessage(open ? null : item.key)} className="settings-still flex w-full items-center justify-between gap-3 px-4 py-3 text-right hover:bg-white">
                              <span>
                                <span className="block text-lg">{meta.title}</span>
                                <span className="mt-0.5 block text-sm text-muted">{meta.when}</span>
                              </span>
                              <ChevronDown size={18} className={`shrink-0 text-goldInk transition ${open ? "rotate-180" : ""}`} />
                            </button>
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
                  <>
                    <h2 className="text-2xl">יומן גוגל</h2>
                    <p className="mt-1 text-muted">החיבור החי מחכה למפתח חשבון שירות. עד אז, כותרת עם [NT:טלפון] נכנסת לתור הבדיקה ביומן.</p>
                    <label className="mt-4 block text-sm text-muted">כותרת האירוע
                      <textarea id="nt-title" placeholder="לק ג'ל [NT:052-123-4567]" className="mt-1 w-full rounded-md border border-lineStrong bg-white p-3 text-ink" rows={3} />
                    </label>
                    <button type="button" onClick={() => {
                      const field = document.getElementById("nt-title") as HTMLTextAreaElement;
                      api("/appointments/reviews/ingest", { method: "POST", body: JSON.stringify({ title: field.value }) }).then(() => { field.value = ""; pushToast("נשמר"); }).catch((error: Error) => pushToast(error.message));
                    }} className="mt-3 rounded-full bg-brand px-5 py-2 text-onBrand">שליחה לבדיקה</button>
                  </>
                ) : null}
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
