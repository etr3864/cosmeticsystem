"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { pushToast } from "@/components/toast";

type Contact = {
  id: string;
  name: string;
  phoneDisplay: string;
  salesStatus: string;
  source: string;
  conversationUrl: string;
  noShowCount: number;
  createdAt: string;
  services: { serviceId: string; opsStatus: string; firstVisitAt: string | null; service: { name: string } }[];
  appointments: { id: string; startsAt: string; status: string; finalPrice: number; notes: string | null; motherDaughter: boolean; service: { name: string } }[];
  timeline: { id: string; type: string; payload: { text?: string; message?: string; status?: string }; createdAt: string }[];
  responses: { answers: Record<string, string>; submittedAt: string }[];
  credits: { remainingPct: number; expiresAt: string }[];
};

const tabs = ["פרטים", "תורים", "בשבילך", "ציר"] as const;

export default function ContactPage({ params }: { params: Promise<{ id: string }> }) {
  const [contact, setContact] = useState<Contact | null>(null);
  const [note, setNote] = useState("");
  const [tab, setTab] = useState<(typeof tabs)[number]>("פרטים");
  const [visitNote, setVisitNote] = useState("");

  async function refresh(id: string) {
    setContact(await api<Contact>(`/contacts/${id}`));
  }

  useEffect(() => { params.then((value) => refresh(value.id)); }, [params]);

  if (!contact) return <p className="text-muted">טוען</p>;
  const credit = contact.credits.filter((item) => new Date(item.expiresAt) > new Date()).reduce((sum, item) => sum + item.remainingPct, 0);

  async function saveNote() {
    await api(`/contacts/${contact!.id}`, { method: "PATCH", body: JSON.stringify({ note }) });
    setNote("");
    pushToast("נשמר");
    await refresh(contact!.id);
  }

  async function sendPartner() {
    const result = await api<{ willSend: boolean }>(`/contacts/${contact!.id}/partner-link`, { method: "POST" });
    pushToast(result.willSend ? "ההודעה נשלחה" : "נשמר במערכת, אין מפתח שליחה");
  }

  async function attend(id: string, status: "הגיעה" | "לא הגיעה") {
    await api(`/appointments/${id}/attendance`, { method: "POST", body: JSON.stringify({ status, notes: visitNote, paymentMethod: status === "הגיעה" ? "מזומן" : undefined }) });
    setVisitNote("");
    pushToast(status === "הגיעה" ? "ההודעה נשלחה" : "נשמר");
    await refresh(contact!.id);
  }

  return (
    <section className="mx-auto h-full max-w-3xl overflow-auto">
      <h1 className="text-[32px] leading-10">{contact.name}</h1>
      <p className="mt-2 text-muted">
        <a className="hover:text-goldInk" href={`tel:${contact.phoneDisplay}`}>{contact.phoneDisplay}</a>
        {" · "}{contact.salesStatus} · {contact.source}
        {credit > 0 ? ` · זיכוי ${credit}%` : ""}
        {contact.noShowCount > 0 ? ` · לא הגיעה ${contact.noShowCount}` : ""}
      </p>
      <div className="mt-4 flex gap-2">
        <a href={contact.conversationUrl} target="_blank" className="rounded-md bg-brand px-4 py-3 text-onBrand">לשיחה עם הסוכנת</a>
        <button onClick={sendPartner} className="rounded-md bg-[#EDE3D6] px-4 py-3">שליחת קישור שותפים</button>
      </div>
      <div className="mt-6 flex gap-2">
        {tabs.map((item) => (
          <button key={item} onClick={() => setTab(item)} className={`rounded-full px-4 py-2 ${tab === item ? "bg-brand text-onBrand" : "bg-sunken"}`}>{item}</button>
        ))}
      </div>
      {tab === "פרטים" ? (
        <div className="mt-4 rounded-xl border border-line bg-surface p-4 shadow-card">
          {contact.services.map((item) => (
            <p key={item.serviceId} className="mb-2">{item.service.name} · {item.opsStatus}{item.firstVisitAt ? ` · נכנסה ${new Date(item.firstVisitAt).toLocaleDateString("he-IL")}` : ""}</p>
          ))}
          <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="הערה פרטית" className="mt-2 w-full rounded-md border border-lineStrong p-3" />
          <button onClick={saveNote} className="mt-2 rounded-md bg-brand px-4 py-2 text-onBrand">שמירת הערה</button>
        </div>
      ) : null}
      {tab === "תורים" ? (
        <div className="mt-4 space-y-3">
          <textarea value={visitNote} onChange={(event) => setVisitNote(event.target.value)} placeholder="מה היה בתור" className="w-full rounded-md border border-lineStrong bg-surface p-3" />
          {contact.appointments.map((item) => (
            <article key={item.id} className="lift rounded-xl border border-line bg-surface p-4 shadow-card">
              <p className="font-bold">{item.service.name} · {item.status} · {item.finalPrice}₪</p>
              <p className="text-sm text-muted">{new Date(item.startsAt).toLocaleString("he-IL")}{item.motherDaughter ? " · אם ובת" : ""}</p>
              {item.notes ? <p className="mt-1 text-sm">{item.notes}</p> : null}
              <div className="mt-3 flex gap-2">
                <button onClick={() => attend(item.id, "הגיעה")} className="rounded-md bg-[#3F6B3A] px-3 py-2 text-white">הגיעה</button>
                <button onClick={() => attend(item.id, "לא הגיעה")} className="rounded-md bg-[#F7E0E5] px-3 py-2 text-[#9B2F45]">לא הגיעה</button>
              </div>
            </article>
          ))}
        </div>
      ) : null}
      {tab === "בשבילך" ? (
        <div className="mt-4 rounded-xl border border-line bg-surface p-4 shadow-card">
          {contact.responses.length === 0 ? <p className="text-muted">עוד לא מילאו יחד.</p> : contact.responses.map((response) => (
            <ul key={response.submittedAt} className="space-y-2">
              {Object.entries(response.answers).map(([key, value]) => <li key={key}><span className="text-faint">{key}</span> · {value}</li>)}
            </ul>
          ))}
        </div>
      ) : null}
      {tab === "ציר" ? (
        <ul className="mt-4 space-y-2">
          {contact.timeline.map((item) => (
            <li key={item.id} className="rounded-lg bg-surface px-3 py-2 shadow-card">
              <span className="text-faint">{new Date(item.createdAt).toLocaleString("he-IL")}</span>
              {" · "}{item.payload.text || item.payload.message || item.payload.status || item.type}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
