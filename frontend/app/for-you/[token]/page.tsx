"use client";

import { FormEvent, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { GuestHero, GuestNote, GuestScreen, firstOf } from "@/components/guest";

type Question = { id: string; label: string; type: string; options?: string[]; detail?: string };
type Payload = { name: string; title: string; serviceId: string | null; questions: Question[] };

export default function ForYouPage({ params }: { params: Promise<{ token: string }> }) {
  const [token, setToken] = useState("");
  const [data, setData] = useState<Payload | null>(null);
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [picked, setPicked] = useState("");
  const [why, setWhy] = useState("");

  useEffect(() => {
    params.then(async (value) => {
      setToken(value.token);
      setData(await api<Payload>(`/public/${value.token}`));
    }).catch((err: Error) => setError(err.message));
  }, [params]);

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
  if (done) {
    return (
      <GuestScreen>
        <GuestHero kicker={firstOf(data.name)} title="זהו">
          <GuestNote>התשובות נשמרו. נשתמש בהן כשמתחילים, כדי שהחומרים יתאימו לך.</GuestNote>
        </GuestHero>
      </GuestScreen>
    );
  }

  const question = data.questions[step];
  if (!question) {
    return (
      <GuestScreen>
        <GuestHero kicker="בשבילך" title="אין שאלות בדף הזה" />
      </GuestScreen>
    );
  }

  async function next(value: string) {
    if (busy || !value.trim()) return;
    const merged = { ...answers, [question.id]: value.trim() };
    setAnswers(merged);
    setPicked("");
    setWhy("");
    if (step + 1 >= data!.questions.length) {
      setBusy(true);
      try {
        await api(`/public/${token}/for-you`, {
          method: "POST",
          body: JSON.stringify({ serviceId: data!.serviceId, answers: merged }),
        });
        setDone(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "לא נשמר");
        setBusy(false);
      }
      return;
    }
    setStep(step + 1);
  }

  function onText(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = new FormData(event.currentTarget).get("value");
    next(String(input ?? ""));
  }

  const progress = ((step + 1) / data.questions.length) * 100;

  return (
    <GuestScreen>
      <GuestHero kicker="לפני שמתחילים" title={data.title || "בשבילך"}>
        <GuestNote>דף קצר, {firstOf(data.name)}. עוברים עליו יחד, כדי להתאים את החומרים לפני הלק.</GuestNote>
      </GuestHero>
      <div className="guest-card mt-8 p-6">
        <div className="guest-bar" aria-hidden>
          <span style={{ width: `${progress}%` }} />
        </div>
        <p className="mt-3 text-sm text-faint">שאלה {step + 1} מתוך {data.questions.length}</p>
        <div key={question.id} className="guest-step">
          <h2 className="mt-4 text-[28px] leading-9 text-ink">{question.label}</h2>
          <div className="mt-5 flex flex-col gap-2">
            {question.options ? (
              <>
                {question.options.map((option) => (
                  <button
                    key={option}
                    disabled={busy}
                    onClick={() => question.detail ? setPicked(option) : next(option)}
                    className={`guest-choice ${picked === option || answers[question.id] === option ? "on" : ""}`}
                  >
                    {option}
                  </button>
                ))}
                {question.detail && picked ? (
                  <form
                    className="guest-step mt-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      next(why.trim() ? `${picked}: ${why.trim()}` : picked);
                    }}
                  >
                    <input
                      value={why}
                      onChange={(event) => setWhy(event.target.value)}
                      className="w-full rounded-2xl border border-lineStrong bg-white px-4 py-4"
                      placeholder={question.detail}
                    />
                    <button disabled={busy} className="guest-confirm mt-3">המשך</button>
                  </form>
                ) : null}
              </>
            ) : (
              <form onSubmit={onText}>
                <input
                  name="value"
                  key={question.id}
                  defaultValue={answers[question.id] ?? ""}
                  className="w-full rounded-2xl border border-lineStrong bg-white px-4 py-4"
                  placeholder="כאן"
                />
                <button disabled={busy} className="guest-confirm mt-3">המשך</button>
              </form>
            )}
          </div>
          {error ? <p className="mt-3 text-sm text-[#9B2F45]">{error}</p> : null}
          {step > 0 ? (
            <button type="button" onClick={() => { setPicked(""); setWhy(""); setStep(step - 1); }} className="mt-4 text-sm text-faint">חזרה לשאלה הקודמת</button>
          ) : null}
        </div>
      </div>
    </GuestScreen>
  );
}
