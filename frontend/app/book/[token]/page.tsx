"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

type Payload = { name: string; expired: boolean; message?: string; price: number; discounted: number; clinic: { address: string; unit: string; parking: string }; days?: { day: string; slots: string[] }[] };

export default function BookPage({ params }: { params: Promise<{ token: string }> }) {
  const [token, setToken] = useState("");
  const [data, setData] = useState<Payload | null>(null);
  const [slots, setSlots] = useState<{ day: string; slots: string[] }[]>([]);
  const [done, setDone] = useState<{ startsAt: string; clinic: { address: string; unit: string; parking: string } } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    params.then(async (value) => {
      setToken(value.token);
      const payload = await api<Payload>(`/public/${value.token}`);
      setData(payload);
      if (!payload.expired) {
        const days = await api<{ days: { day: string; slots: string[] }[] }>(`/public/${value.token}/slots`);
        setSlots(days.days);
      }
    }).catch((err: Error) => setError(err.message));
  }, [params]);

  async function book(startsAt: string) {
    try {
      const result = await api<{ startsAt: string; clinic: { address: string; unit: string; parking: string } }>(`/public/${token}/book`, { method: "POST", body: JSON.stringify({ startsAt }) });
      setDone(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "השעה נתפסה");
    }
  }

  if (error) return <main className="mx-auto max-w-md p-6"><p>{error}</p></main>;
  if (!data) return <main className="p-6">טוען</main>;
  if (data.expired) return <main className="mx-auto max-w-md p-8 text-center"><h1 className="text-[32px]">ההטבה הסתיימה</h1></main>;
  if (done) {
    const maps = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(done.clinic.address)}`;
    return (
      <main className="mx-auto max-w-md p-8 text-center">
        <p className="text-goldInk">היופי שבקצה האצבעות שלך</p>
        <h1 className="mt-2 text-[40px] leading-[48px]">התור נקבע</h1>
        <p className="mt-4">{new Date(done.startsAt).toLocaleString("he-IL")}</p>
        <p className="mt-4">{done.clinic.address}</p>
        <p>{done.clinic.unit}</p>
        <p>{done.clinic.parking}</p>
        <a href={maps} className="mt-6 inline-block rounded-md bg-brand px-4 py-3 text-onBrand">ניווט</a>
      </main>
    );
  }

  return (
    <main className="page-in mx-auto max-w-md p-6">
      <p className="text-goldInk">היופי שבקצה האצבעות שלך</p>
      <h1 className="mt-2 text-[32px]">{data.name}</h1>
      <p className="mt-2 text-muted"><s>{data.price} ₪</s> <span className="text-[40px] font-extrabold text-ink">{data.discounted} ₪</span></p>
      {slots.map((day) => (
        <section key={day.day} className="mt-4">
          <h2 className="text-lg font-bold">{day.day}</h2>
          <div className="mt-2 flex flex-wrap gap-2">
            {day.slots.map((slot) => <button key={slot} onClick={() => book(slot)} className="rounded-md bg-[#EDE3D6] px-3 py-2">{new Date(slot).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })}</button>)}
          </div>
        </section>
      ))}
    </main>
  );
}
