"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

type Question = { id: string; label: string; type: string; options?: string[]; detail?: string };
type Payload = { name: string; title: string; serviceId: string | null; questions: Question[] };

export default function ForYouPage({ params }: { params: Promise<{ token: string }> }) {
  const [token, setToken] = useState("");
  const [data, setData] = useState<Payload | null>(null);
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);

  useEffect(() => {
    params.then(async (value) => {
      setToken(value.token);
      setData(await api<Payload>(`/public/${value.token}`));
    });
  }, [params]);

  if (!data) return <main className="p-6">טוען</main>;
  if (done) return <main className="mx-auto max-w-md p-8 text-center"><h1 className="text-[40px]">תודה</h1><p className="mt-2">נמשיך מזה יחד.</p></main>;
  const question = data.questions[step];
  if (!question) return null;

  async function next(value: string) {
    const merged = { ...answers, [question.id]: value };
    setAnswers(merged);
    if (step + 1 >= data!.questions.length) {
      await api(`/public/${token}/for-you`, { method: "POST", body: JSON.stringify({ serviceId: data!.serviceId, answers: merged }) });
      setDone(true);
      return;
    }
    setStep(step + 1);
  }

  return (
    <main className="page-in mx-auto flex min-h-screen max-w-md flex-col justify-center p-6">
      <p className="text-goldInk">היופי שבקצה האצבעות שלך</p>
      <h1 className="mt-2 text-[32px]">{data.title}</h1>
      <p className="mt-2 text-muted">{step + 1} מתוך {data.questions.length}</p>
      <h2 className="mt-6 text-2xl">{question.label}</h2>
      <div className="mt-4 flex flex-col gap-2">
        {question.options ? question.options.map((option) => (
          <button key={option} onClick={() => next(option)} className="rounded-md bg-[#EDE3D6] px-4 py-4 text-right">{option}</button>
        )) : (
          <form onSubmit={(event) => { event.preventDefault(); const input = new FormData(event.currentTarget).get("value"); next(String(input ?? "")); }}>
            <input name="value" className="w-full rounded-md border border-lineStrong px-3 py-3" />
            <button className="mt-3 rounded-md bg-brand px-4 py-3 text-onBrand">הבא</button>
          </form>
        )}
      </div>
    </main>
  );
}
