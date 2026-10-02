"use client";

import { FormEvent, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { pushToast } from "@/components/toast";
import { ContactDrawer } from "@/components/contact-drawer";
import { BookingDialog } from "@/components/booking-dialog";
import { useDismiss } from "@/components/dismiss";

type Row = {
  id: string;
  name: string;
  phone: string;
  salesStatus: string;
  source: string;
  createdAt: string;
  visits: number;
  booked: boolean;
  services: { serviceId: string; status: string; firstVisitAt: string | null }[];
};

const leadStatuses = ["ליד חדש", "אין מענה 1", "אין מענה 2", "אין מענה 3", "נקבע תור AI", "נקבע תור אנושי", "לא רלוונטית"];
const ops = ["חדשה", "חוזרת", "קבועה", "בסיכון", "רדומה", "עזבה"];
const sources = ["מודעה ממומנת", "המלצה מלקוחה", "קבוצת וואטסאפ", "אינסטגרם אורגני", "פנייה ישירה לנועה", "אחר"];

export function RecordTable({ kind }: { kind: "lead" | "client" }) {
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [items, setItems] = useState<Row[]>([]);
  const [status, setStatus] = useState("");
  const [source, setSource] = useState("");
  const [opsStatus, setOpsStatus] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const [ask, setAsk] = useState<string | null>(null);
  const [journey, setJourney] = useState<{ id: string; top: number; left: number } | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [bookLead, setBookLead] = useState<Row | null>(null);
  const askDismiss = useDismiss(() => { setAsk(null); setPendingId(null); setReason(""); });
  const journeyDismiss = useDismiss(() => setJourney(null));
  const deleteDismiss = useDismiss(() => setConfirmDelete(false));
  const params = useSearchParams();
  useEffect(() => { const open = params.get("open"); if (open) setOpenId(open); }, [params]);

  function query(nextPage = page) {
    const params = new URLSearchParams({ kind, page: String(nextPage) });
    if (status) params.set("status", status);
    if (source) params.set("source", source);
    if (opsStatus) params.set("ops", opsStatus);
    return params;
  }

  function load(nextPage = page) {
    api<{ items: Row[]; total: number }>(`/contacts?${query(nextPage)}`).then((data) => {
      setItems(data.items);
      setTotal(data.total);
    }).catch((error: Error) => pushToast(error.message));
  }

  useEffect(() => { setPage(1); setSelected([]); load(1); }, [kind, status, source, opsStatus]);

  const pages = Math.max(1, Math.ceil(total / 25));
  const pageIds = items.map((row) => row.id);
  const allPage = pageIds.length > 0 && pageIds.every((id) => selected.includes(id));
  const somePage = pageIds.some((id) => selected.includes(id));

  function togglePage() {
    setSelected(allPage ? selected.filter((id) => !pageIds.includes(id)) : Array.from(new Set([...selected, ...pageIds])));
  }

  function openJourney(event: { currentTarget: HTMLButtonElement }, id: string) {
    const rect = event.currentTarget.getBoundingClientRect();
    const width = Math.min(280, window.innerWidth - 32);
    const left = Math.max(16, Math.min(rect.right - width, window.innerWidth - width - 16));
    const chrome = window.innerWidth < 1024 ? 88 : 16;
    const top = Math.min(rect.bottom + 8, Math.max(16, window.innerHeight - 460 - chrome));
    setJourney({ id, top, left });
  }

  function toggleRow(id: string) {
    setSelected(selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id]);
  }

  async function apply(next: string) {
    if ((next === "לא רלוונטית" || next === "עזבה") && !reason.trim()) {
      setAsk(next);
      return;
    }
    if (next === "נקבע תור אנושי") {
      pushToast("נקבע תור נעשה מתוך השורה, כדי לקבוע את התור");
      return;
    }
    if (next === "אין מענה 3") {
      const settings = await api<{ automations: { key: string; active: boolean }[] }>("/settings");
      const sends = settings.automations.find((item) => item.key === "no_answer_3")?.active;
      if (sends && !window.confirm(`יישלחו ${selected.length} הודעות.`)) return;
    }
    const saved = await api<{ messages?: number }>("/contacts/bulk", {
      method: "POST",
      body: JSON.stringify(next === "עזבה" ? { ids: selected, opsStatus: "עזבה", leftReason: reason } : { ids: selected, salesStatus: next, reason }),
    });
    setSelected([]);
    if (ask) askDismiss.requestClose();
    pushToast(saved.messages ? "ההודעה נשלחה" : "נשמר");
    load();
  }

  async function removeSelected() {
    try {
      await Promise.all(selected.map((id) => api(`/contacts/${id}`, { method: "DELETE" })));
      setSelected([]);
      deleteDismiss.requestClose();
      pushToast("נמחק");
      load();
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "לא הצלחנו למחוק");
    }
  }

  async function changeOne(row: Row, next: string) {
    if ((next === "לא רלוונטית" || next === "עזבה") && !reason.trim()) {
      setPendingId(row.id);
      setAsk(next);
      return;
    }
    if (kind === "lead" && next === "נקבע תור אנושי") {
      if (!row.booked) {
        setBookLead(row);
        return;
      }
      if (row.salesStatus === "נקבע תור AI" || row.salesStatus === "נקבע תור אנושי") return;
      await api(`/contacts/${row.id}`, { method: "PATCH", body: JSON.stringify({ salesStatus: "נקבע תור אנושי" }) });
      pushToast("נשמר");
      load();
      return;
    }
    const saved = kind === "lead"
      ? await api<{ messageQueued?: boolean }>(`/contacts/${row.id}`, { method: "PATCH", body: JSON.stringify({ salesStatus: next, reason }) })
      : row.services[0]
        ? await api<{ messageQueued?: boolean }>(`/contacts/${row.id}`, { method: "PATCH", body: JSON.stringify({ opsStatus: next, serviceId: row.services[0].serviceId, leftReason: reason }) })
        : null;
    if (ask) askDismiss.requestClose();
    else { setReason(""); setPendingId(null); }
    pushToast(saved?.messageQueued ? "ההודעה נשלחה" : "נשמר");
    load();
  }

  async function onFile(file: File) {
    const XLSX = await import("xlsx");
    const book = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const sheet = book.Sheets[book.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { raw: false });
    const result = await api<{ created: number; skipped: string[] }>("/contacts/import", { method: "POST", body: JSON.stringify({ rows }) });
    pushToast(`נכנסו ${result.created}, דולגו ${result.skipped.length}`);
    load(1);
  }

  return (
    <section className="flex h-full flex-col">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="display-title text-[32px] leading-9 lg:text-[40px] lg:leading-10">{kind === "lead" ? "לידים" : "לקוחות"}</h1>
          <p className="text-sm text-muted">{total} רשומות</p>
        </div>
        <div className="flex gap-2">
          {kind === "lead" ? (
            <label className="chip rounded-full px-4 py-2">
              ייבוא
              <input type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void onFile(file); }} />
            </label>
          ) : null}
          <a className="chip rounded-full px-4 py-2" href={`/backend/contacts/export/file?kind=${kind}${status ? `&status=${status}` : ""}`}>ייצוא</a>
        </div>
      </div>
      <div className="filters mb-3 flex flex-wrap gap-2">
        <select value={kind === "lead" ? status : opsStatus} onChange={(event) => kind === "lead" ? setStatus(event.target.value) : setOpsStatus(event.target.value)} className="min-w-0 flex-1 rounded-md border border-lineStrong bg-surface px-3 py-2 sm:flex-none">
          <option value="">כל הסטטוסים</option>
          {(kind === "lead" ? leadStatuses : ops).map((item) => <option key={item}>{item}</option>)}
        </select>
        <select value={source} onChange={(event) => setSource(event.target.value)} className="min-w-0 flex-1 rounded-md border border-lineStrong bg-surface px-3 py-2 sm:flex-none">
          <option value="">כל המקורות</option>
          {sources.map((item) => <option key={item}>{item}</option>)}
        </select>
        {selected.length > 0 ? (
          <>
            <select defaultValue="" onChange={(event) => { if (event.target.value) void apply(event.target.value); event.target.value = ""; }} className="rounded-md border border-lineStrong bg-white px-3 py-2 text-ink">
              <option value="">שינוי סטטוס למי שנבחר</option>
              {(kind === "lead" ? leadStatuses : ["עזבה"]).map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
            <button onClick={() => setConfirmDelete(true)} className="rounded-md bg-[#F7E0E5] px-3 py-2 text-[#9B2F45]">מחיקה</button>
          </>
        ) : null}
      </div>
      {ask ? createPortal(
        <>
          <button className={`drawer-bg book-layer${askDismiss.leaving ? " out" : ""}`} aria-label="סגירה" onClick={() => askDismiss.requestClose()} />
          <div className="book-layer pointer-events-none fixed inset-0 flex items-center justify-center p-4">
            <form onSubmit={(event: FormEvent) => { event.preventDefault(); if (!reason.trim()) return; pendingId ? changeOne(items.find((row) => row.id === pendingId)!, ask) : apply(ask); }} onAnimationEnd={askDismiss.onAnimationEnd} className={`glass pointer-events-auto w-[min(420px,100%)] rounded-xl p-6 ${askDismiss.leaving ? "sheet-out" : "sheet-in"}`}>
              <h2 className="text-2xl">{ask}</h2>
              <p className="mt-2 text-muted">בלי סיבה אי אפשר להעביר.</p>
              <textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="סיבה" className="mt-4 w-full rounded-md border border-lineStrong bg-white p-3" rows={3} />
              <div className="mt-4 flex gap-2">
                <button disabled={!reason.trim()} className="rounded-full bg-brand px-5 py-2 text-onBrand">העברה</button>
                <button type="button" onClick={() => askDismiss.requestClose()} className="rounded-full bg-white/80 px-5 py-2">סגירה</button>
              </div>
            </form>
          </div>
        </>,
        document.body,
      ) : null}
      <div className="ledger min-h-0 flex-1 overflow-auto rounded-xl border">
        <ul className="space-y-2 p-2 md:hidden">
          {items.map((row) => (
            <li key={row.id} className={`rounded-xl border border-line bg-white p-3 ${selected.includes(row.id) ? "picked" : ""}`}>
              <div className="flex items-start gap-3">
                <Pick on={selected.includes(row.id)} label={`בחירת ${row.name}`} onToggle={() => toggleRow(row.id)} />
                <button type="button" onClick={() => setOpenId(row.id)} className="min-w-0 flex-1 text-right">
                  <span className="block font-bold">{row.name}</span>
                  <span className="mt-0.5 block text-sm text-muted">{new Date(kind === "client" ? row.services[0]?.firstVisitAt ?? row.createdAt : row.createdAt).toLocaleDateString("he-IL")} · {kind === "lead" ? row.source : `${row.visits} הגעות`}</span>
                </button>
                <a href={`tel:${row.phone}`} className="shrink-0 rounded-full bg-sunken px-3 py-2 text-sm font-bold">חיוג</a>
              </div>
              <div className="mt-2 flex items-center justify-between gap-2">
                <button type="button" onClick={(event) => openJourney(event, row.id)} className="rounded-full border border-line bg-white px-3 py-1 text-sm">{kind === "client" ? row.services[0]?.status || "ללא מסלול" : row.salesStatus}</button>
                <span className="text-sm text-muted" dir="ltr">{row.phone}</span>
              </div>
            </li>
          ))}
        </ul>
        <table className="data-table hidden w-full min-w-[720px] text-right text-[15px] md:table">
          <thead className="sticky top-0 bg-sunken text-[13px] text-muted">
            <tr>
              <th className="p-3"><Pick on={allPage} mixed={!allPage && somePage} label="בחירת העמוד" onToggle={togglePage} /></th>
              <th className="p-3">שם</th>
              <th className="p-3">טלפון</th>
              <th className="p-3">סטטוס</th>
              <th className="p-3">{kind === "lead" ? "כניסה" : "כניסה כלקוחה"}</th>
              <th className="p-3">{kind === "lead" ? "מקור" : "הגעות"}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr key={row.id} className={`border-t border-line ${selected.includes(row.id) ? "picked" : ""}`}>
                <td className="p-3"><Pick on={selected.includes(row.id)} label={`בחירת ${row.name}`} onToggle={() => toggleRow(row.id)} /></td>
                <td className="p-3"><button onClick={() => setOpenId(row.id)} className="row-name font-bold">{row.name}</button></td>
                <td className="whitespace-nowrap p-3"><a href={`tel:${row.phone}`} className="hover:text-goldInk">{row.phone}</a></td>
                <td className="whitespace-nowrap p-3">
                  <button type="button" onClick={(event) => openJourney(event, row.id)} className="rounded-full border border-line bg-white px-3 py-1 text-sm">{kind === "client" ? row.services[0]?.status || "ללא מסלול" : row.salesStatus}</button>
                </td>
                <td className="p-3">{new Date(kind === "client" ? row.services[0]?.firstVisitAt ?? row.createdAt : row.createdAt).toLocaleDateString("he-IL")}</td>
                <td className="p-3">{kind === "lead" ? row.source : row.visits}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {items.length === 0 ? <p className="p-8 text-muted">עוד אין כאן רשומות.</p> : null}
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button disabled={page <= 1} onClick={() => { const next = page - 1; setPage(next); load(next); }} className="rounded-md bg-[#EDE3D6] px-4 py-2">הקודם</button>
        <span>{page} / {pages}</span>
        <button disabled={page >= pages} onClick={() => { const next = page + 1; setPage(next); load(next); }} className="rounded-md bg-[#EDE3D6] px-4 py-2">הבא</button>
      </div>
      {journey ? createPortal(
        <>
          <button className="fixed inset-0 z-40 bg-transparent" aria-label="סגירה" onClick={() => journeyDismiss.requestClose()} />
          <div onAnimationEnd={journeyDismiss.onAnimationEnd} className={`glass fixed z-50 w-[min(280px,calc(100vw-32px))] rounded-xl p-4 ${journeyDismiss.leaving ? "pop-out" : "pop-in"}`} style={{ top: journey.top, left: journey.left }}>
            <Journey kind={kind} current={items.find((row) => row.id === journey.id)} onPick={(next) => { const row = items.find((item) => item.id === journey.id); journeyDismiss.requestClose(); if (row) void changeOne(row, next); }} />
          </div>
        </>,
        document.body,
      ) : null}
      {bookLead ? (
        <BookingDialog
          startsAt={nextOpenSlot()}
          lockContact={{ id: bookLead.id, name: bookLead.name, phone: bookLead.phone }}
          onClose={() => setBookLead(null)}
          onBooked={() => {
            setBookLead(null);
            load();
          }}
        />
      ) : null}
      {openId ? <ContactDrawer id={openId} kind={kind} onChanged={() => load()} onClose={() => { setOpenId(null); load(); }} /> : null}
      {confirmDelete ? (
        <>
          <button className={`drawer-bg${deleteDismiss.leaving ? " out" : ""}`} aria-label="סגירה" onClick={() => deleteDismiss.requestClose()} />
          <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-4">
          <div onAnimationEnd={deleteDismiss.onAnimationEnd} className={`glass pointer-events-auto w-[min(420px,100%)] rounded-xl p-6 ${deleteDismiss.leaving ? "sheet-out" : "sheet-in"}`}>
            <h2 className="text-2xl">{selected.length === 1 ? (kind === "lead" ? "למחוק ליד אחד?" : "למחוק לקוחה אחת?") : `למחוק ${selected.length} ${kind === "lead" ? "לידים" : "לקוחות"}?`}</h2>
            <p className="mt-2 text-muted">המחיקה סופית, אי אפשר לשחזר.</p>
            <div className="mt-4 flex gap-2">
              <button onClick={() => void removeSelected()} className="rounded-full bg-[#9B2F45] px-5 py-3 text-white">מחיקה</button>
              <button onClick={() => deleteDismiss.requestClose()} className="rounded-full bg-white/80 px-5 py-3">ביטול</button>
            </div>
          </div>
          </div>
        </>
      ) : null}
    </section>
  );
}

function Journey({ kind, current, onPick }: { kind: "lead" | "client"; current?: Row; onPick: (next: string) => void }) {
  const steps = kind === "lead"
    ? [{ id: "ליד חדש", label: "ליד" }, { id: "אין מענה 1", label: "אין מענה 1" }, { id: "אין מענה 2", label: "אין מענה 2" }, { id: "אין מענה 3", label: "אין מענה 3" }, { id: "נקבע תור אנושי", label: "נקבע תור" }]
    : [{ id: "חדשה", label: "הגיעה" }, { id: "חוזרת", label: "חוזרת" }, { id: "קבועה", label: "קבועה" }];
  const sides = kind === "lead" ? ["לא הגיעה", "לא רלוונטית"] : ["בסיכון", "רדומה", "עזבה"];
  const status = kind === "lead" ? current?.salesStatus ?? "" : current?.services[0]?.status ?? "";
  const index = steps.findIndex((step) => step.id === status);
  return (
    <div>
      <p className="text-sm font-bold text-goldInk">{kind === "lead" ? "מסלול הליד" : "מסלול הלקוחה"}</p>
      <div className="mt-3 flex flex-col">
        {steps.map((step, stepIndex) => {
          const done = index >= 0 && stepIndex < index;
          const now = stepIndex === index;
          return (
            <button key={step.id} type="button" onClick={() => onPick(step.id)} className="relative flex w-full items-center gap-3 py-2 text-right">
              {stepIndex < steps.length - 1 ? <span className={`absolute top-7 -bottom-2 w-0.5 start-[13px] ${done ? "bg-brand" : "bg-line"}`} /> : null}
              <span className={`relative z-10 grid h-7 w-7 shrink-0 place-items-center rounded-full border-2 text-xs font-bold ${now ? "border-brand bg-[#F1C968] text-ink shadow-[0_0_0_4px_#F6ECD6]" : done ? "border-brand bg-brand text-onBrand" : "border-[#D6C6B3] bg-white text-faint"}`}>{done ? "✓" : stepIndex + 1}</span>
              <span className={`text-sm ${now ? "font-bold text-brand" : "text-muted"}`}>{step.label}</span>
            </button>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {sides.map((item) => (
          <button key={item} type="button" onClick={() => onPick(item)} className={`rounded-full px-3 py-1 text-sm ${status === item ? "bg-[#9B2F45] text-white" : "bg-[#F7E0E5] text-[#9B2F45]"}`}>{item}</button>
        ))}
      </div>
    </div>
  );
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

function Pick({ on, mixed, label, onToggle }: { on: boolean; mixed?: boolean; label: string; onToggle: () => void }) {
  return (
    <button type="button" aria-pressed={on} aria-label={label} onClick={onToggle} className={`pick ${on ? "on" : ""} ${mixed ? "mixed" : ""}`}>
      {on ? (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
      ) : mixed ? <span className="block h-0.5 w-2.5 rounded-full bg-current" /> : null}
    </button>
  );
}

