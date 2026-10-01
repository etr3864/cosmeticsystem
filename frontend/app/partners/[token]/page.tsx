"use client";

import { FormEvent, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { GuestHero, GuestNote, GuestScreen, firstOf, guestClock, guestDay, guestWhen } from "@/components/guest";

type Day = { day: string; slots: string[] };

export default function PartnersPage({ params }: { params: Promise<{ token: string }> }) {
  const [name, setName] = useState("");
  const [token, setToken] = useState("");
  const [days, setDays] = useState<Day[]>([]);
  const [slot, setSlot] = useState("");
  const [done, setDone] = useState("");
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    params.then(async (value) => {
      setToken(value.token);
      const data = await api<{ name: string }>(`/public/${value.token}`);
      setName(data.name);
      const slots = await api<{ days: Day[] }>(`/public/${value.token}/slots`);
      setDays(slots.days.filter((day) => day.slots.length > 0));
      setReady(true);
    }).catch((err: Error) => setError(err.message));
  }, [params]);

  const share = typeof window === "undefined" ? "" : `https://wa.me/?text=${encodeURIComponent(`${name} שמרה לך 10% על תור אצל נועה. נכנסים, בוחרים שעה, וההנחה כבר על המחיר: ${window.location.href}`)}`;

  async function book(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      if (!slot) {
        await api(`/public/${token}/join`, { method: "POST", body: JSON.stringify({ name: data.get("name"), phone: data.get("phone") }) });
        setDone("השם והטלפון נשמרו. נועה תחזור עם שעה.");
        return;
      }
      const result = await api<{ startsAt: string }>(`/public/${token}/book-friend`, {
        method: "POST",
        body: JSON.stringify({ name: data.get("name"), phone: data.get("phone"), startsAt: slot }),
      });
      setDone(`התור נקבע ל${guestWhen(result.startsAt)}, עם 10% כבר על המחיר.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "השעה נתפסה");
      setBusy(false);
    }
  }

  if (error && !ready) {
    return (
      <GuestScreen>
        <GuestHero kicker="נועה טורג'מן" title="הקישור לא נפתח">
          <GuestNote>{error}</GuestNote>
        </GuestHero>
      </GuestScreen>
    );
  }
  if (!ready) {
    return (
      <GuestScreen>
        <GuestHero kicker="נועה טורג'מן" title="רגע" />
      </GuestScreen>
    );
  }

  return (
    <GuestScreen>
      <GuestHero kicker={name ? `${firstOf(name)} הזמינה אותך` : "הזמנה"} title="10% על התור הראשון">
        <GuestNote>בוחרים שעה ללק ג&apos;ל. ההנחה כבר על המחיר. אחרי ההגעה, למי שהזמינה נשמר 10% לשלושה חודשים.</GuestNote>
      </GuestHero>
      <a href={share} target="_blank" className="mt-6 block rounded-full bg-[#3F6B3A] py-3 text-center text-white">שליחת ההזמנה לחברה</a>
      {done ? (
        <section className="guest-card guest-step mt-6 p-6 text-center">
          <h2 className="text-[32px] text-ink">נשמר</h2>
          <p className="mt-2 leading-7 text-muted">{done}</p>
        </section>
      ) : (
        <form onSubmit={book} className="guest-card mt-6 space-y-4 p-6">
          <p className="text-sm leading-6 text-muted">אם הקישור הגיע אלייך, מלאי שם וטלפון ובחרי שעה.</p>
          <input name="name" required placeholder="שם" className="w-full rounded-2xl border border-lineStrong bg-white px-4 py-3" />
          <input name="phone" required placeholder="טלפון" inputMode="tel" className="w-full rounded-2xl border border-lineStrong bg-white px-4 py-3" />
          <div className="space-y-5">
            {days.length === 0 ? <p className="text-sm text-muted">אין שעות פנויות בחלון הקרוב. אפשר להשאיר פרטים, ונועה תחזור עם שעה.</p> : days.map((day) => (
              <div key={day.day}>
                <p className="mb-2 text-sm text-faint">{guestDay(day.day)}</p>
                <div className="flex flex-wrap gap-2">
                  {day.slots.map((item) => (
                    <button
                      type="button"
                      key={item}
                      onClick={() => setSlot(slot === item ? "" : item)}
                      className={`rounded-full px-3 py-1.5 ${slot === item ? "bg-brand text-onBrand" : "bg-sunken text-ink"}`}
                    >
                      {guestClock(item)}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          {slot ? <p className="text-sm text-goldInk">השעה שנבחרה: {guestWhen(slot)}</p> : null}
          {error ? <p className="text-sm text-[#9B2F45]">{error}</p> : null}
          <button disabled={busy} className="w-full rounded-full bg-brand py-3 text-onBrand">{slot ? "קביעת התור" : "השארת פרטים בלי שעה"}</button>
        </form>
      )}
    </GuestScreen>
  );
}
