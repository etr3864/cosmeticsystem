"use client";

import { FormEvent, useEffect, useState } from "react";
import { api } from "@/lib/api";

type Day = { day: string; slots: string[] };

export default function PartnersPage({ params }: { params: Promise<{ token: string }> }) {
  const [name, setName] = useState("");
  const [token, setToken] = useState("");
  const [days, setDays] = useState<Day[]>([]);
  const [slot, setSlot] = useState("");
  const [done, setDone] = useState("");

  useEffect(() => {
    params.then(async (value) => {
      setToken(value.token);
      const data = await api<{ name: string }>(`/public/${value.token}`);
      setName(data.name);
      const slots = await api<{ days: Day[] }>(`/public/${value.token}/slots`);
      setDays(slots.days.filter((day) => day.slots.length > 0));
    });
  }, [params]);

  const share = typeof window === "undefined" ? "" : `https://wa.me/?text=${encodeURIComponent(`${name} שמרה לך 10% על תור אצל נועה. הקישור פותח את השעות הפנויות, עם ההנחה כבר על המחיר: ${window.location.href}`)}`;

  async function book(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    if (!slot) {
      await api(`/public/${token}/join`, { method: "POST", body: JSON.stringify({ name: data.get("name"), phone: data.get("phone") }) });
      setDone("נרשמת. נועה תחזור אלייך לקביעת התור.");
      return;
    }
    const result = await api<{ startsAt: string }>(`/public/${token}/book-friend`, {
      method: "POST",
      body: JSON.stringify({ name: data.get("name"), phone: data.get("phone"), startsAt: slot }),
    });
    setDone(`התור נקבע ל־${new Date(result.startsAt).toLocaleString("he-IL")}, עם 10% כבר על המחיר.`);
  }

  return (
    <main className="page-in mx-auto min-h-screen max-w-md px-6 py-10">
      <img src="/logo.jpg" alt="" className="mx-auto mb-4 h-20 w-20 rounded-full" />
      <h1 className="text-center text-[32px]">{name}</h1>
      <p className="mt-3 text-center text-muted">הדף הזה הוא הזמנה. חברה שנכנסת קובעת תור עם 10% הנחה. אחרי שהיא מגיעה, נשמר זיכוי של 10% לשלושה חודשים.</p>
      <a href={share} target="_blank" className="mt-6 block rounded-md bg-[#3F6B3A] py-3 text-center text-white">שליחה לחברה בוואטסאפ</a>
      {done ? <p className="mt-6 text-center">{done}</p> : (
        <form onSubmit={book} className="mt-6 space-y-3">
          <input name="name" required placeholder="שם" className="w-full rounded-md border border-lineStrong bg-surface px-3 py-3" />
          <input name="phone" required placeholder="טלפון" className="w-full rounded-md border border-lineStrong bg-surface px-3 py-3" />
          <div className="max-h-64 space-y-3 overflow-auto">
            {days.map((day) => (
              <div key={day.day}>
                <p className="mb-1 text-sm text-faint">{new Date(day.day).toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "numeric" })}</p>
                <div className="flex flex-wrap gap-2">
                  {day.slots.map((item) => (
                    <button type="button" key={item} onClick={() => setSlot(item)} className={`rounded-full px-3 py-1 ${slot === item ? "bg-brand text-onBrand" : "bg-sunken"}`}>
                      {new Date(item).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <button className="w-full rounded-md bg-brand py-3 text-onBrand">{slot ? "קביעת התור" : "השארת פרטים"}</button>
        </form>
      )}
    </main>
  );
}
