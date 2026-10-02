"use client";

import { FormEvent, ReactNode, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { BackButton } from "@/components/back-button";
import { pushToast } from "@/components/toast";
import { BookingDialog } from "@/components/booking-dialog";
import { useDismiss } from "@/components/dismiss";

type Appointment = { id: string; startsAt: string; createdAt: string; status: string; finalPrice: number; amountPaid: number | null; paymentMethod: string | null; notes: string | null; service: { name: string; code: string; price: number } };
type Contact = {
  id: string;
  name: string;
  phoneDisplay: string;
  salesStatus: string;
  notRelevantReason: string | null;
  source: string;
  sourceDetail: string | null;
  conversationUrl: string;
  noShowCount: number;
  createdAt: string;
  services: { serviceId: string; opsStatus: string; leftReason: string | null; firstVisitAt: string | null; lastVisitAt: string | null; service: { name: string; code: string; hasForYou: boolean } }[];
  appointments: Appointment[];
  timeline: { id: string; type: string; actor: string; payload: { text?: string; message?: string; status?: string; reason?: string; appointmentId?: string; cancelled?: boolean; created?: boolean; service?: string; startsAt?: string; changes?: { field: string; from: string; to: string }[] }; createdAt: string }[];
  credits: { remainingPct: number; expiresAt: string }[];
  referredBy: { name: string } | null;
  forYou: { applies: boolean; filled: boolean; items: { label: string; value: string }[] };
  links: LinkRow[];
};

type LinkRow = {
  id: string | null;
  kind: "questionnaire" | "discount_booking" | "referral";
  label: string;
  detail: string;
  url: string | null;
  createdAt: string | null;
  sentAt: string | null;
  expiresAt: string | null;
  live: boolean;
};

export function ContactDrawer({ id, kind, onClose, onChanged }: { id: string; kind: "lead" | "client"; onClose: () => void; onChanged?: () => void }) {
  const [contact, setContact] = useState<Contact | null>(null);
  const [note, setNote] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [visitNote, setVisitNote] = useState("");
  const [reason, setReason] = useState("");
  const [pay, setPay] = useState<"ביט" | "מזומן">("ביט");
  const [paid, setPaid] = useState("");
  const [bookAt, setBookAt] = useState<Date | null>(null);
  const [reasonAsk, setReasonAsk] = useState(false);
  const [details, setDetails] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftPhone, setDraftPhone] = useState("");
  const [draftSource, setDraftSource] = useState("");
  const [draftDetail, setDraftDetail] = useState("");
  const { leaving, requestClose, onAnimationEnd } = useDismiss(onClose);

  function load() {
    return api<Contact>(`/contacts/${id}`).then(setContact);
  }
  useEffect(() => { load().catch((error: Error) => pushToast(error.message)); }, [id]);

  if (!contact) {
    return (<><button className={`drawer-bg${leaving ? " out" : ""}`} aria-label="סגירה" onClick={() => requestClose()} /><aside onAnimationEnd={onAnimationEnd} className={`drawer glass ${leaving ? "sheet-out" : "sheet-in"}`}><BackButton onClick={() => requestClose()} /><p>טוען</p></aside></>);
  }
  const person = contact;

  const isClient = person.salesStatus === "לקוחה פעילה";
  const mode = isClient ? "client" : kind;
  const credit = person.credits.filter((item) => new Date(item.expiresAt) > new Date()).reduce((sum, item) => sum + item.remainingPct, 0);
  const arrived = person.appointments.filter((item) => item.status === "הגיעה").length;
  const appointments = person.appointments.filter((item) => item.status !== "בוטל").length;
  const decided = arrived + person.appointments.filter((item) => item.status === "לא הגיעה").length;
  const showRate = decided ? Math.round((arrived / decided) * 100) : null;

  async function setStatus(next: string) {
    if (mode === "lead" && next === "נקבע תור אנושי") {
      const booked = person.appointments.some((item) => item.status === "נקבע");
      if (!booked) {
        setBookAt(nextOpenSlot());
        return;
      }
      if (person.salesStatus === "נקבע תור AI" || person.salesStatus === "נקבע תור אנושי") return;
      await api(`/contacts/${person.id}`, { method: "PATCH", body: JSON.stringify({ salesStatus: "נקבע תור אנושי" }) });
      pushToast("נשמר");
      await load();
      return;
    }
    if (mode === "lead" && next === "לא רלוונטית") {
      setReason("");
      setReasonAsk(true);
      return;
    }
    if (next === "עזבה" && !reason.trim()) {
      pushToast("חסרה סיבה");
      return;
    }
    const saved = mode === "lead"
      ? await api<{ messageQueued?: boolean }>(`/contacts/${person.id}`, { method: "PATCH", body: JSON.stringify({ salesStatus: next, reason }) })
      : person.services[0]
        ? await api<{ messageQueued?: boolean }>(`/contacts/${person.id}`, { method: "PATCH", body: JSON.stringify({ opsStatus: next, serviceId: person.services[0].serviceId, leftReason: reason }) })
        : null;
    pushToast(saved?.messageQueued ? "ההודעה נשלחה" : "נשמר");
    await load();
  }

  function openEdit(item: Appointment) {
    setEditingId(item.id);
    setVisitNote(item.notes ?? "");
    setPay(item.paymentMethod === "מזומן" ? "מזומן" : "ביט");
    setPaid(String(item.amountPaid ?? item.finalPrice));
  }

  function shekels() {
    const amount = Number(paid);
    if (!Number.isInteger(amount) || amount < 0) return null;
    return amount;
  }

  function openDetails() {
    setDraftName(person.name);
    setDraftPhone(person.phoneDisplay);
    setDraftSource(person.source);
    setDraftDetail(person.sourceDetail ?? "");
    setDetails(true);
  }

  async function saveDetails(event: FormEvent) {
    event.preventDefault();
    const name = draftName.trim();
    const phone = draftPhone.trim();
    if (!name || !phone) {
      pushToast("חסר שם או טלפון");
      return;
    }
    try {
      await api(`/contacts/${person.id}`, { method: "PATCH", body: JSON.stringify({ name, phone, source: draftSource, sourceDetail: draftDetail.trim() }) });
      setDetails(false);
      pushToast("נשמר");
      await load();
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "לא הצלחנו");
    }
  }

  async function confirmIrrelevant(event: FormEvent) {
    event.preventDefault();
    const text = reason.trim();
    if (!text) return;
    await api(`/contacts/${person.id}`, { method: "PATCH", body: JSON.stringify({ salesStatus: "לא רלוונטית", reason: text }) });
    setReasonAsk(false);
    setReason("");
    pushToast("נשמר");
    await load();
  }

  async function saveVisit(item: Appointment) {
    const amount = shekels();
    if (amount == null) {
      pushToast("סכום לא תקין");
      return;
    }
    try {
      await api(`/appointments/${item.id}`, { method: "PATCH", body: JSON.stringify({ notes: visitNote, amountPaid: amount, paymentMethod: pay }) });
      pushToast("נשמר");
      await load();
      onChanged?.();
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "לא הצלחנו");
    }
  }

  async function removeVisit(item: Appointment) {
    if (!window.confirm("למחוק את התור?")) return;
    try {
      await api(`/appointments/${item.id}/cancel`, { method: "POST" });
      setEditingId(null);
      pushToast("נמחק");
      await load();
      onChanged?.();
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "לא הצלחנו");
    }
  }

  async function attend(appointmentId: string, status: "הגיעה" | "לא הגיעה") {
    const amount = status === "הגיעה" ? shekels() : null;
    if (status === "הגיעה" && amount == null) {
      pushToast("סכום לא תקין");
      return;
    }
    const saved = await api<{ messageQueued?: boolean }>(`/appointments/${appointmentId}/attendance`, { method: "POST", body: JSON.stringify({ status, notes: visitNote, paymentMethod: status === "הגיעה" ? pay : undefined, ...(amount != null ? { amountPaid: amount } : {}) }) });
    setEditingId(null);
    setVisitNote("");
    if (status === "הגיעה" && !isClient) pushToast("עברה ללקוחות");
    else pushToast(saved.messageQueued ? "ההודעה נשלחה" : "נשמר");
    await load();
    onChanged?.();
  }

  return (
    <>
      <button className={`drawer-bg${leaving ? " out" : ""}`} aria-label="סגירה" onClick={() => requestClose()} />
      <aside onAnimationEnd={onAnimationEnd} className={`drawer glass ${leaving ? "sheet-out" : "sheet-in"}`}>
        <BackButton onClick={() => requestClose()} />
        <div className={isClient ? "rounded-xl bg-brand px-4 py-4 text-onBrand" : "rounded-xl border border-[#E8DDD0] bg-[#FBF6EE] px-4 py-4 text-ink"}>
          <p className={`text-[12px] font-bold tracking-[0.16em] ${isClient ? "" : "text-goldInk"}`}>{isClient ? "לקוחה" : "ליד"}</p>
          <h2 className="mt-1 break-words text-[28px] leading-9 sm:text-[32px] sm:leading-10">{person.name}</h2>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <a href={`tel:${person.phoneDisplay}`} className="rounded-full bg-white px-4 py-2 font-bold text-ink">{person.phoneDisplay}</a>
          <a href={person.conversationUrl} target="_blank" className="rounded-full bg-brand px-4 py-2 font-bold text-onBrand">לשיחה עם הסוכנת</a>
          <button type="button" onClick={() => details ? setDetails(false) : openDetails()} className="rounded-full bg-white px-4 py-2">{details ? "סגירה" : "עריכת פרטים"}</button>
        </div>
        {details ? (
          <form onSubmit={saveDetails} className="mt-3 space-y-2 rounded-xl bg-white/75 p-4">
            <label className="block text-sm text-muted">שם
              <input value={draftName} onChange={(event) => setDraftName(event.target.value)} className="mt-1 w-full rounded-md border border-lineStrong bg-white px-3 py-2 text-ink" />
            </label>
            <label className="block text-sm text-muted">טלפון
              <input value={draftPhone} onChange={(event) => setDraftPhone(event.target.value)} inputMode="tel" className="mt-1 w-full rounded-md border border-lineStrong bg-white px-3 py-2 text-ink" />
            </label>
            <label className="block text-sm text-muted">מקור
              <select value={draftSource} onChange={(event) => setDraftSource(event.target.value)} className="mt-1 w-full rounded-md border border-lineStrong bg-white px-3 py-2 text-ink">
                {sourceOptions(person.source).map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
            <label className="block text-sm text-muted">פירוט המקור
              <input value={draftDetail} onChange={(event) => setDraftDetail(event.target.value)} placeholder="שם הקמפיין, מי המליצה, או כל דבר שכדאי לזכור" className="mt-1 w-full rounded-md border border-lineStrong bg-white px-3 py-2 text-ink" />
            </label>
            <button className="rounded-full bg-brand px-4 py-2 text-onBrand">שמירה</button>
          </form>
        ) : null}
        {isClient ? (
          <div className="mt-4 grid grid-cols-3 gap-2">
            <div className="rounded-xl bg-white/75 px-3 py-3"><p className="text-2xl">{arrived}</p><p className="text-sm text-faint">הגעות</p></div>
            <div className="rounded-xl bg-white/75 px-3 py-3"><p className="text-2xl">{appointments}</p><p className="text-sm text-faint">תורים</p></div>
            <div className="rounded-xl bg-white/75 px-3 py-3"><p className="text-2xl">{showRate == null ? "—" : `${showRate}%`}</p><p className="text-sm text-faint">אחוז הגעה</p></div>
          </div>
        ) : null}

        <section className="mt-4 rounded-xl bg-white/75 p-4">
          <h3 className="text-lg">{isClient ? "מסלול הלקוחה" : "מסלול הליד"}</h3>
          {isClient ? (
            <Path steps={[{ id: "חדשה", label: "הגיעה" }, { id: "חוזרת", label: "חוזרת" }, { id: "קבועה", label: "קבועה" }]} current={["חדשה", "חוזרת", "קבועה"].indexOf(person.services[0]?.opsStatus ?? "")} onPick={setStatus} />
          ) : (
            <Path steps={[{ id: "ליד חדש", label: "ליד" }, { id: "אין מענה 1", label: "אין מענה 1" }, { id: "אין מענה 2", label: "אין מענה 2" }, { id: "אין מענה 3", label: "אין מענה 3" }, { id: "נקבע תור אנושי", label: "נקבע תור" }]} current={leadStep(person.salesStatus)} onPick={setStatus} />
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {(isClient ? ["בסיכון", "רדומה", "עזבה"] : ["לא הגיעה", "לא רלוונטית"]).map((item) => {
              const on = isClient ? person.services[0]?.opsStatus === item : person.salesStatus === item;
              return <button key={item} onClick={() => setStatus(item)} className={`rounded-full px-3 py-1 text-sm ${on ? "bg-[#9B2F45] text-white" : "bg-[#F7E0E5] text-[#9B2F45]"}`}>{item}</button>;
            })}
          </div>
          {reasonAsk ? (
            <form onSubmit={confirmIrrelevant} className="mt-3 rounded-xl border border-line bg-white p-3">
              <p className="text-sm text-muted">בלי סיבה אי אפשר להעביר.</p>
              <textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="סיבה" autoFocus className="mt-2 w-full rounded-md border border-lineStrong p-3" rows={3} />
              <div className="mt-2 flex gap-2">
                <button disabled={!reason.trim()} className="rounded-full bg-brand px-4 py-2 text-onBrand">העברה</button>
                <button type="button" onClick={() => { setReasonAsk(false); setReason(""); }} className="rounded-full bg-sunken px-4 py-2">סגירה</button>
              </div>
            </form>
          ) : null}
          {reasonLine(person, isClient) ? <p className="mt-3 rounded-lg bg-[#FBF6EE] px-3 py-2 text-sm"><span className="text-faint">סיבה · </span>{reasonLine(person, isClient)}</p> : null}
          <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-lg bg-[#FBF6EE] px-3 py-2"><dt className="text-faint">מקור</dt><dd>{person.source}{person.sourceDetail ? ` · ${person.sourceDetail}` : ""}</dd></div>
            {credit > 0 ? <div className="rounded-lg bg-[#FBF6EE] px-3 py-2"><dt className="text-faint">זיכוי</dt><dd>{credit}%</dd></div> : null}
            {person.referredBy ? <div className="rounded-lg bg-[#FBF6EE] px-3 py-2"><dt className="text-faint">הגיעה דרך</dt><dd>{person.referredBy.name}</dd></div> : null}
            {person.services.map((item) => (
              <div key={item.serviceId} className="rounded-lg bg-[#FBF6EE] px-3 py-2"><dt className="text-faint">{item.service.name}</dt><dd>{item.opsStatus}{item.firstVisitAt ? ` · ${new Date(item.firstVisitAt).toLocaleDateString("he-IL")}` : ""}</dd></div>
            ))}
          </dl>
        </section>

        {person.appointments.some((item) => item.status !== "בוטל") ? <section className="mt-4 rounded-xl bg-white/75 p-4">
          <h3 className="text-lg">תורים</h3>
          <div className={`mt-3 space-y-4 pe-1 ${editingId ? "" : "max-h-80 overflow-y-auto"}`}>
              {visitGroups(person.appointments.filter((item) => item.status !== "בוטל")).map((group) => (
                <div key={group.label}>
                  <p className="sticky top-0 z-10 bg-[#FBF8F4]/95 py-1 text-sm font-bold text-goldInk">{group.label}</p>
                  <ul className="space-y-2">
                    {group.items.map((item) => {
                      const when = visitParts(item.startsAt);
                      const open = editingId === item.id;
                      return (
                        <li key={item.id} className="rounded-xl border border-line bg-white px-3 py-3">
                          <div className="flex items-center gap-3">
                            <div className="w-16 shrink-0">
                              <p className="text-xs text-faint">{when.weekday}</p>
                              <p className="font-bold leading-5">{when.day}</p>
                              <p className="text-sm text-muted">{when.time}</p>
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="font-bold">{item.service.name}</p>
                              <p className="text-sm text-muted">{moneyLine(item)}</p>
                              {open || !item.notes ? null : <p className="mt-1 text-sm">{item.notes}</p>}
                            </div>
                            <span className={`shrink-0 text-sm font-bold ${statusTone(item.status)}`}>{item.status}</span>
                            <button type="button" onClick={() => open ? setEditingId(null) : openEdit(item)} className={`shrink-0 rounded-full px-3 py-1 text-sm ${open ? "bg-sunken" : "bg-brand text-onBrand"}`}>{open ? "סגירה" : "עריכה"}</button>
                          </div>
                          {open ? (
                            <div className="mt-3 space-y-3 border-t border-line pt-3">
                              <div>
                                <p className="text-sm font-bold">תשלום</p>
                                <label className="mt-2 block text-sm text-muted">כמה שילמה
                                  <input value={paid} onChange={(event) => setPaid(event.target.value.replace(/\D/g, ""))} inputMode="numeric" className="mt-1 w-full rounded-md border border-lineStrong px-3 py-2 text-ink" />
                                </label>
                                <p className="mt-1 text-xs text-faint">המחירון {item.service.price}₪. הסכום כאן נשמר רק על התור הזה.</p>
                                <p className="mt-2 text-sm text-muted">איך שילמה</p>
                                <div className="mt-1 flex gap-2">
                                  {(["ביט", "מזומן"] as const).map((method) => <button key={method} type="button" onClick={() => setPay(method)} className={`rounded-full px-3 py-1 ${pay === method ? "bg-brand text-onBrand" : "bg-sunken"}`}>{method}</button>)}
                                </div>
                              </div>
                              <label className="block text-sm text-muted">מה היה בתור
                                <textarea value={visitNote} onChange={(event) => setVisitNote(event.target.value)} placeholder="מה היה בתור" className="mt-1 w-full rounded-md border border-lineStrong p-3 text-ink" rows={3} />
                              </label>
                              <div>
                                <p className="text-sm font-bold">הגעה</p>
                                <div className="mt-2 flex flex-wrap gap-2">
                                  <button type="button" onClick={() => attend(item.id, "הגיעה")} className="rounded-full bg-[#3F6B3A] px-4 py-2 text-white">הגיעה</button>
                                  <button type="button" onClick={() => attend(item.id, "לא הגיעה")} className="rounded-full bg-[#F7E0E5] px-4 py-2 text-[#9B2F45]">לא הגיעה</button>
                                </div>
                              </div>
                              <div className="flex flex-wrap gap-2 border-t border-line pt-3">
                                <button type="button" onClick={() => saveVisit(item)} className="rounded-full bg-brand px-4 py-2 text-onBrand">שמירת התשלום</button>
                                <button type="button" onClick={() => removeVisit(item)} className="rounded-full bg-[#9B2F45] px-4 py-2 text-white">מחיקת התור</button>
                              </div>
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
          </div>
        </section> : null}

        <section className="mt-4 rounded-xl bg-white/75 p-4">
          <h3 className="text-lg">תיעוד והערות</h3>
          <Notes person={person} note={note} setNote={setNote} onSaved={load} />
        </section>
        <button onClick={async () => { if (!window.confirm("למחוק את הכרטיס?")) return; await api(`/contacts/${person.id}`, { method: "DELETE" }); requestClose(); }} className="mb-2 mt-8 block text-sm text-[#9B2F45]">מחיקת הכרטיס</button>
      </aside>
      {bookAt ? (
        <BookingDialog
          startsAt={bookAt}
          lockContact={{ id: person.id, name: person.name, phone: person.phoneDisplay }}
          onClose={() => setBookAt(null)}
          onBooked={() => { setBookAt(null); void load(); }}
        />
      ) : null}
    </>
  );
}

const leadSources = ["פנייה ישירה לנועה", "מודעה ממומנת", "המלצה מלקוחה", "קבוצת וואטסאפ", "אינסטגרם אורגני", "אחר"];

function visitParts(iso: string) {
  const date = new Date(iso);
  return {
    weekday: date.toLocaleDateString("he-IL", { weekday: "short" }),
    day: date.toLocaleDateString("he-IL", { day: "numeric", month: "numeric" }),
    time: date.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" }),
  };
}

function moneyLine(item: Appointment) {
  if (item.amountPaid != null) return `שילמה ${item.amountPaid}₪${item.paymentMethod ? ` ב${item.paymentMethod}` : ""}`;
  return `${item.finalPrice}₪ לפי המחירון`;
}

function statusTone(status: string) {
  if (status === "הגיעה") return "text-[#3F6B3A]";
  if (status === "לא הגיעה") return "text-[#9B2F45]";
  return "text-goldInk";
}

function visitGroups(items: Appointment[]) {
  const groups: { label: string; items: Appointment[] }[] = [];
  for (const item of items) {
    const label = new Date(item.startsAt).toLocaleDateString("he-IL", { month: "long", year: "numeric" });
    const last = groups[groups.length - 1];
    if (last?.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return groups;
}

function sourceOptions(current: string) {
  return leadSources.includes(current) ? leadSources : [current, ...leadSources];
}

function nextOpenSlot() {
  const next = new Date();
  next.setSeconds(0, 0);
  if (next.getMinutes() < 30) next.setMinutes(30);
  else {
    next.setHours(next.getHours() + 1);
    next.setMinutes(0);
  }
  if (next.getHours() < 8 || next.getHours() > 20) next.setHours(9, 0, 0, 0);
  return next;
}

function Links({ contact, questionnaireFilled, onChanged }: { contact: Contact; questionnaireFilled: boolean; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const live = contact.links.filter((row) => row.live).length;

  async function run(key: string, action: () => Promise<void>) {
    setBusy(key);
    try {
      await action();
      await onChanged();
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "לא הצלחנו");
    } finally {
      setBusy(null);
    }
  }

  async function create(row: LinkRow) {
    if (row.live && !window.confirm("ליצור קישור חדש? הקישור הקודם יפסיק לעבוד.")) return;
    const result = await api<{ fresh: boolean }>(`/contacts/${contact.id}/links`, {
      method: "POST",
      body: JSON.stringify({ kind: row.kind, replace: row.live }),
    });
    pushToast(result.fresh ? "הקישור מוכן" : "כבר יש קישור פעיל");
  }

  async function send(row: LinkRow) {
    const result = await api<{ willSend: boolean }>(`/contacts/${contact.id}/links/send`, {
      method: "POST",
      body: JSON.stringify({ kind: row.kind }),
    });
    pushToast(result.willSend ? "ההודעה נשלחה" : "נשמר במערכת, אין מפתח שליחה");
  }

  async function revoke(row: LinkRow) {
    if (!row.id || !window.confirm("לבטל את הקישור? אחר כך הוא לא ייפתח.")) return;
    await api(`/contacts/${contact.id}/links/${row.id}/revoke`, { method: "POST" });
    pushToast("הקישור בוטל");
  }

  async function copy(url: string) {
    await navigator.clipboard.writeText(url);
    pushToast("הקישור הועתק");
  }

  return (
    <Fold title="קישורים" count={live} open={open} onToggle={() => setOpen((value) => !value)}>
      <p className="mt-3 text-sm text-muted">הספירה מתחילה ברגע היצירה. שליחה שולחת את הקישור שכבר פתוח.</p>
      <ul className="mt-4 space-y-3">
        {contact.links.map((row) => {
          const locked = row.kind === "questionnaire" && questionnaireFilled;
          return (
            <li key={row.kind} className="rounded-lg bg-[#FBF6EE] p-3">
              <p className="font-bold">{row.label}</p>
              <p className="mt-1 text-sm text-muted">{row.detail}</p>
              {locked ? <p className="mt-3 text-sm">כבר מילאו יחד.</p> : null}
              {row.live && row.url ? (
                <div className="mt-3">
                  <p dir="ltr" className="break-all text-right text-sm text-ink">{row.url}</p>
                  <p className="mt-2 text-sm text-muted">
                    נוצר {stamp(row.createdAt)}
                    {" · "}
                    {row.sentAt ? `נשלח ${stamp(row.sentAt)}` : "עוד לא נשלח"}
                    {row.expiresAt ? ` · בתוקף עד ${stamp(row.expiresAt)}` : ""}
                  </p>
                </div>
              ) : locked ? null : <p className="mt-3 text-sm">אין קישור.</p>}
              {locked ? null : (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" disabled={busy === row.kind} onClick={() => run(row.kind, () => create(row))} className="rounded-full bg-white px-4 py-2">יצירת קישור</button>
                  <button type="button" disabled={busy === row.kind} onClick={() => run(row.kind, () => send(row))} className="rounded-full bg-brand px-4 py-2 text-onBrand">שליחה</button>
                  {row.live && row.url ? <button type="button" disabled={busy === row.kind} onClick={() => copy(row.url!)} className="rounded-full bg-white px-4 py-2">העתקה</button> : null}
                  {row.live && row.id ? <button type="button" disabled={busy === row.kind} onClick={() => run(row.kind, () => revoke(row))} className="rounded-full bg-[#9B2F45] px-4 py-2 text-white">ביטול הקישור</button> : null}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Fold>
  );
}

function stamp(value: string | null) {
  if (!value) return "";
  return new Date(value).toLocaleString("he-IL", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });
}

function ForYou({ contact }: { contact: Contact }) {
  if (!contact.forYou.filled) return null;
  return (
    <div className="mt-8">
      <h3 className="text-lg">תוצאות שאלון</h3>
      <ul className="mt-4 space-y-3">
        {contact.forYou.items.map((item) => (
          <li key={item.label} className="rounded-xl bg-white/70 p-3">
            <p className="text-sm text-faint">{item.label}</p>
            <p className="font-bold">{item.value}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Notes({ person, note, setNote, onSaved }: { person: Contact; note: string; setNote: (value: string) => void; onSaved: () => Promise<void> }) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const notes = collectNotes(person);
  const activity = person.timeline.filter((item) => item.type !== "note");
  const groups = new Map<string, NoteCard[]>();
  for (const item of notes) {
    const key = dayKey(item.at);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }

  async function save() {
    const text = note.trim();
    if (!text) return;
    await api(`/contacts/${person.id}`, { method: "PATCH", body: JSON.stringify({ note: text }) });
    setNote("");
    pushToast("נשמר");
    await onSaved();
  }

  async function saveEdit(item: NoteCard) {
    const text = draft.trim();
    if (!text) return;
    try {
      await api(`/contacts/${person.id}/notes/${item.id}`, { method: "PATCH", body: JSON.stringify({ text }) });
      setEditingId(null);
      pushToast("נשמר");
      await onSaved();
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "לא הצלחנו");
    }
  }

  async function remove(item: NoteCard) {
    if (!window.confirm("למחוק את ההערה?")) return;
    await api(`/contacts/${person.id}/notes/${item.id}`, { method: "DELETE" });
    if (editingId === item.id) setEditingId(null);
    pushToast("נמחק");
    await onSaved();
  }

  return (
    <div className="mt-3">
      <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="הערה חדשה" className="w-full rounded-md border border-lineStrong bg-white p-3" rows={3} />
      <button onClick={save} disabled={!note.trim()} className="mt-2 rounded-full bg-brand px-4 py-2 text-onBrand disabled:opacity-40">שמירה</button>
      {notes.length === 0 ? <p className="mt-4 text-muted">אין עדיין הערות.</p> : (
        <div className="mt-5 space-y-5">
          {[...groups.entries()].map(([key, items]) => (
            <section key={key}>
              <p className="text-sm font-bold text-goldInk">{dayLabel(items[0].at)}</p>
              <ul className="mt-2 space-y-2">
                {items.map((item) => (
                  <li key={item.id} className="rounded-xl bg-white/75 px-3 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-xs text-faint">{clock(item.at)}{item.actor === "ai" ? " · שירה" : ""}</p>
                      <span className="flex gap-3">
                        <button type="button" onClick={() => { setEditingId(item.id); setDraft(item.text); }} className="text-xs text-goldInk">עריכה</button>
                        <button type="button" onClick={() => remove(item)} className="text-xs text-[#9B2F45]">מחיקה</button>
                      </span>
                    </div>
                    {editingId === item.id ? (
                      <div className="mt-2">
                        <textarea value={draft} onChange={(event) => setDraft(event.target.value)} className="w-full rounded-md border border-lineStrong bg-white p-3" rows={3} />
                        <div className="mt-2 flex gap-2">
                          <button type="button" onClick={() => saveEdit(item)} disabled={!draft.trim()} className="rounded-full bg-brand px-3 py-1 text-sm text-onBrand disabled:opacity-40">שמירה</button>
                          <button type="button" onClick={() => setEditingId(null)} className="rounded-full bg-white px-3 py-1 text-sm">ביטול</button>
                        </div>
                      </div>
                    ) : <p className="mt-1 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{item.text}</p>}
                    <p className="mt-2 text-xs text-muted">{item.visit ? `מתור ${item.visit.service.name} · ${visitWhen(item.visit.startsAt)}` : "הערה כללית"}</p>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      <ForYou contact={person} />
      <Links contact={person} questionnaireFilled={person.forYou.filled} onChanged={onSaved} />
      <Fold title="מה קרה" count={activity.length} open={historyOpen} onToggle={() => setHistoryOpen((value) => !value)}>
        {activity.length === 0 ? <p className="mt-3 text-muted">עוד אין אירועים.</p> : (
          <ol className="mt-4">
            {activity.map((item, index) => {
              const detail = lineOf(item);
              return (
                <li key={item.id} className="relative pb-5 ps-7">
                  {index < activity.length - 1 ? <span className="absolute bottom-0 top-3 w-px bg-line start-[6px]" /> : null}
                  <span className="absolute start-0 top-1 size-3.5 rounded-full border-2 border-brand bg-[#FBF8F4]" />
                  <p className="text-xs text-faint">{eventDate(item.createdAt)} · {clock(item.createdAt)} · {whoDid(item.actor)}</p>
                  <p className="mt-0.5 font-bold">{titleOf(item)}</p>
                  {detail ? <p className="whitespace-pre-wrap break-words text-sm [overflow-wrap:anywhere]">{detail}</p> : null}
                </li>
              );
            })}
          </ol>
        )}
      </Fold>
    </div>
  );
}

function Fold({ title, count, open, onToggle, children }: { title: string; count: number; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <div className="mt-8">
      <button type="button" aria-expanded={open} onClick={onToggle} className="flex w-full items-center gap-2 text-right">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`text-brand transition ${open ? "rotate-180" : ""}`}><path d="m6 9 6 6 6-6" /></svg>
        <h3 className="text-xl">{title}</h3>
        <span className="text-sm text-faint">{count}</span>
      </button>
      {open ? children : null}
    </div>
  );
}

type NoteCard = { id: string; text: string; at: string; actor: string; visit: Appointment | null };

function collectNotes(person: Contact): NoteCard[] {
  const fromTimeline = person.timeline
    .filter((item) => item.type === "note" && item.payload.text?.trim())
    .map((item) => ({
      id: item.id,
      text: item.payload.text!.trim(),
      at: item.createdAt,
      actor: item.actor,
      visit: person.appointments.find((appointment) => appointment.id === item.payload.appointmentId) ?? null,
    }));
  const covered = new Set(fromTimeline.map((item) => `${item.visit?.id ?? ""}:${item.text}`));
  const fromVisits = person.appointments
    .filter((item) => item.notes?.trim() && !covered.has(`${item.id}:${item.notes.trim()}`))
    .map((item) => ({ id: `visit-${item.id}`, text: item.notes!.trim(), at: item.createdAt, actor: "user", visit: item }));
  return [...fromTimeline, ...fromVisits].sort((a, b) => +new Date(b.at) - +new Date(a.at));
}

function eventDate(value: string) {
  return new Date(value).toLocaleDateString("he-IL", { timeZone: "Asia/Jerusalem", day: "numeric", month: "long", year: "numeric" });
}

function whoDid(actor: string) {
  if (actor === "ai") return "שירה";
  if (actor === "automation") return "המערכת";
  if (actor === "noa") return "נועה";
  if (actor === "eitan") return "איתן";
  if (actor === "client") return "הלקוחה";
  if (actor === "user" || actor === "system") return "צוות";
  return actor;
}

function reasonLine(person: Contact, isClient: boolean) {
  if (!isClient && person.salesStatus === "לא רלוונטית") return person.notRelevantReason;
  const service = person.services.find((item) => item.opsStatus === "עזבה") ?? person.services[0];
  if (!service) return null;
  if (service.opsStatus === "עזבה") return service.leftReason;
  if (service.opsStatus === "רדומה" || service.opsStatus === "בסיכון") {
    if (!service.lastVisitAt) return null;
    const days = Math.max(0, Math.floor((Date.now() - new Date(service.lastVisitAt).getTime()) / 86_400_000));
    return `הביקור האחרון לפני ${days} ימים`;
  }
  return null;
}

function leadStep(status: string) {
  if (status === "ליד חדש") return 0;
  if (status === "אין מענה ל-AI" || status === "אין מענה 1") return 1;
  if (status === "אין מענה 2") return 2;
  if (status === "אין מענה 3") return 3;
  if (status === "נקבע תור AI" || status === "נקבע תור אנושי") return 4;
  return -1;
}

function Path({ steps, current, onPick }: { steps: { id: string; label: string }[]; current: number; onPick: (id: string) => void }) {
  return (
    <div className="mt-4 flex items-start">
      {steps.map((step, index) => {
        const done = current >= 0 && index < current;
        const now = index === current;
        return (
          <button key={step.id} type="button" onClick={() => onPick(step.id)} className="relative flex min-w-0 flex-1 flex-col items-center gap-1.5">
            {index < steps.length - 1 ? <span className={`absolute top-[13px] h-0.5 w-full start-1/2 ${done ? "bg-brand" : "bg-line"}`} /> : null}
            <span className={`relative z-10 grid h-7 w-7 place-items-center rounded-full border-2 text-xs font-bold ${now ? "border-brand bg-[#F1C968] text-ink shadow-[0_0_0_4px_#F6ECD6]" : done ? "border-brand bg-brand text-onBrand" : "border-[#D6C6B3] bg-white text-faint"}`}>{done ? "✓" : index + 1}</span>
            <span className={`text-center text-[12px] leading-4 ${now ? "font-bold text-brand" : done ? "text-ink" : "text-faint"}`}>{step.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function clock(value: string) {
  return new Date(value).toLocaleTimeString("he-IL", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit" });
}

function visitWhen(value: string) {
  return new Date(value).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });
}

function dayKey(value: string) {
  return new Date(value).toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
}

function dayLabel(value: string) {
  const key = dayKey(value);
  if (key === dayKey(new Date().toISOString())) return "היום";
  if (key === dayKey(new Date(Date.now() - 86_400_000).toISOString())) return "אתמול";
  return new Date(value).toLocaleDateString("he-IL", { timeZone: "Asia/Jerusalem", weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

function lineOf(item: Contact["timeline"][number]) {
  if (item.type === "status_change") return [item.payload.status, item.payload.reason].filter(Boolean).join(" · ");
  if (item.type === "appointment") {
    const when = item.payload.startsAt ? visitWhen(item.payload.startsAt) : "";
    const action = item.payload.cancelled ? "התור נמחק" : "נקבע תור";
    return when ? `${action} · ${when}` : action;
  }
  if (item.type === "automation_sent") return item.payload.message || "הודעה";
  if (item.type === "field_change") return fieldLine(item.payload);
  return item.payload.text || item.payload.message || item.payload.status || "";
}

function fieldLine(payload: Contact["timeline"][number]["payload"]) {
  if (payload.changes?.length) return payload.changes.map(changeLine).join("\n");
  if (payload.service) return `נוסף ${payload.service}`;
  return "נפתח כרטיס";
}

function changeLine(change: { field: string; from: string; to: string }) {
  if (change.from && change.to) return `${change.field} · ${change.from} ל־${change.to}`;
  if (change.to) return `${change.field} · ${change.to}`;
  if (change.from) return `${change.field} נמחק, היה ${change.from}`;
  return change.field;
}

function titleOf(item: Contact["timeline"][number]) {
  if (item.type === "field_change" && item.payload.changes?.length) return "עריכה";
  if (item.type === "field_change" && item.payload.service) return "שירות";
  return labelOf(item.type);
}

function labelOf(type: string) {
  if (type === "note") return "הערה";
  if (type === "status_change") return "סטטוס";
  if (type === "appointment") return "תור";
  if (type === "automation_sent") return "הודעה";
  if (type === "field_change") return "כרטיס";
  if (type === "ai_summary") return "סיכום";
  return type;
}
