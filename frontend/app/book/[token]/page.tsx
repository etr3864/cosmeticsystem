"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { Clinic, GuestHero, GuestNote, GuestScreen, firstOf, guestClock, guestDay, guestWhen } from "@/components/guest";

type Payload = {
  name: string;
  expired: boolean;
  price: number;
  discounted: number;
  expiresAt: string | null;
  clinic: Clinic;
};

function OfferClock({ until, onDone }: { until: string; onDone: () => void }) {
  const done = useRef(onDone);
  done.current = onDone;
  const [left, setLeft] = useState(() => Math.max(0, new Date(until).getTime() - Date.now()));

  useEffect(() => {
    const end = new Date(until).getTime();
    let fired = false;
    const tick = () => {
      const next = end - Date.now();
      setLeft(Math.max(0, next));
      if (next <= 0 && !fired) {
        fired = true;
        done.current();
      }
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [until]);

  const total = Math.floor(left / 1000);
  const parts = [
    { value: Math.floor(total / 3600), label: "שעות" },
    { value: Math.floor((total % 3600) / 60), label: "דקות" },
    { value: total % 60, label: "שניות" },
  ];

  return (
    <div className="guest-card mt-6 px-5 py-5 text-center">
      <p className="text-sm font-bold text-goldInk">ההנחה נסגרת בעוד</p>
      <div className="mt-3 flex justify-center gap-3">
        {parts.map((part) => (
          <div key={part.label} className="min-w-16 rounded-2xl bg-sunken px-3 py-2">
            <p className="text-[32px] font-extrabold leading-none tabular-nums text-ink">{String(part.value).padStart(2, "0")}</p>
            <p className="mt-1 text-xs text-faint">{part.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function BookPage({ params }: { params: Promise<{ token: string }> }) {
  const [token, setToken] = useState("");
  const [data, setData] = useState<Payload | null>(null);
  const [slots, setSlots] = useState<{ day: string; slots: string[] }[]>([]);
  const [done, setDone] = useState<{ startsAt: string; clinic: Clinic } | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    params.then(async (value) => {
      setToken(value.token);
      const payload = await api<Payload>(`/public/${value.token}`);
      setData(payload);
      if (!payload.expired) {
        const days = await api<{ days: { day: string; slots: string[] }[] }>(`/public/${value.token}/slots`);
        setSlots(days.days.filter((day) => day.slots.length > 0));
      }
    }).catch((err: Error) => setError(err.message));
  }, [params]);

  async function book(startsAt: string) {
    if (busy) return;
    setBusy(startsAt);
    setError("");
    try {
      const result = await api<{ startsAt: string; clinic?: Clinic }>(`/public/${token}/book`, {
        method: "POST",
        body: JSON.stringify({ startsAt }),
      });
      setDone({ startsAt: result.startsAt, clinic: result.clinic?.address ? result.clinic : data!.clinic });
    } catch (err) {
      setError(err instanceof Error ? err.message : "השעה נתפסה");
    } finally {
      setBusy("");
    }
  }

  if (error && !data) {
    return (
      <GuestScreen>
        <GuestHero kicker="נועה טורג'מן" title="הקישור לא נפתח">
          <GuestNote>{error}</GuestNote>
        </GuestHero>
      </GuestScreen>
    );
  }
  if (!data) {
    return (
      <GuestScreen>
        <GuestHero kicker="נועה טורג'מן" title="רגע" />
      </GuestScreen>
    );
  }
  if (data.expired) {
    return (
      <GuestScreen>
        <GuestHero kicker="ההנחה נסגרה" title="24 השעות עברו">
          <GuestNote>ההנחה הייתה פתוחה יממה אחת מרגע שהקישור נוצר. אם בא לך תור במחיר הרגיל, כותבים לנועה וקובעים.</GuestNote>
        </GuestHero>
      </GuestScreen>
    );
  }
  if (done) {
    const maps = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(done.clinic.address)}`;
    return (
      <GuestScreen>
        <GuestHero kicker="נשמר" title="התור נקבע">
          <GuestNote>
            <p>{guestWhen(done.startsAt)}</p>
            <p>10% כבר על המחיר.</p>
          </GuestNote>
        </GuestHero>
        <section className="guest-card guest-rise mt-8 p-6 text-center">
          <p className="text-lg text-ink">{done.clinic.address}</p>
          <p className="mt-1 text-muted">{done.clinic.unit}</p>
          <p className="mt-1 text-sm text-faint">{done.clinic.parking}</p>
          <a href={maps} target="_blank" className="mt-5 inline-flex rounded-full bg-brand px-6 py-3 text-onBrand">ניווט למקום</a>
        </section>
      </GuestScreen>
    );
  }

  return (
    <GuestScreen>
      <GuestHero kicker="ההנחה שלך" title={firstOf(data.name)}>
        <div className="guest-card mx-auto mt-6 max-w-xs px-6 py-5 text-center">
          <p className="text-sm text-faint">לק ג&apos;ל, המחיר הרגיל</p>
          <p className="mt-1 text-xl text-faint line-through">{data.price}₪</p>
          <p className="mt-2 text-[56px] font-extrabold leading-none text-ink">{data.discounted}₪</p>
          <p className="mt-2 text-sm font-bold text-goldInk">10% הנחה. חוסכת {data.price - data.discounted}₪</p>
        </div>
        <GuestNote>נועה שמרה לך את המחיר הזה. בוחרים שעה, וההנחה כבר עליו.</GuestNote>
      </GuestHero>
      {data.expiresAt ? <OfferClock until={data.expiresAt} onDone={() => setData({ ...data, expired: true })} /> : null}
      {error ? <p className="mt-4 text-center text-sm text-[#9B2F45]">{error}</p> : null}
      <div className="mt-8 space-y-4">
        {slots.length === 0 ? (
          <p className="guest-card p-6 text-center text-muted">אין שעות פנויות בחלון הקרוב. כדאי לכתוב לנועה ולבקש זמן אחר.</p>
        ) : slots.map((day) => (
          <section key={day.day} className="guest-card p-5">
            <h2 className="text-xl text-ink">{guestDay(day.day)}</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {day.slots.map((slot) => (
                <button
                  key={slot}
                  disabled={busy !== "" && busy !== slot}
                  onClick={() => book(slot)}
                  className={`rounded-full px-4 py-2 disabled:opacity-40 ${busy === slot ? "bg-brand text-onBrand disabled:opacity-100" : "bg-sunken text-ink"}`}
                >
                  {guestClock(slot)}
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </GuestScreen>
  );
}
