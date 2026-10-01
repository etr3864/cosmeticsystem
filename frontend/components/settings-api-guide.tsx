"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { pushToast } from "@/components/toast";
import { externalApiBlocks, externalApiGuideMarkdown } from "@/lib/external-api-guide";

type TokenRow = { id: string; name: string; active: boolean; lastUsedAt: string | null; createdAt: string };

function guideBase(apiBase: string) {
  const saved = apiBase.replace(/\/$/, "");
  if (saved.startsWith("https://")) return saved;
  if (typeof window === "undefined") return saved;
  return `${window.location.origin}/backend`;
}

export function SettingsApiGuide({ apiBase }: { apiBase: string }) {
  const base = guideBase(apiBase);
  const [tokens, setTokens] = useState<TokenRow[] | null>(null);
  const [name, setName] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ tokens: TokenRow[] }>("/settings/tokens").then((data) => setTokens(data.tokens)).catch((error: Error) => pushToast(error.message));
  }, []);

  function createToken() {
    const next = name.trim();
    if (!next) return;
    setBusy(true);
    api<{ token: string; id: string; name: string; createdAt: string }>("/settings/tokens", { method: "POST", body: JSON.stringify({ name: next }) })
      .then((created) => {
        setFresh(created.token);
        setName("");
        setTokens((rows) => [{ id: created.id, name: created.name, active: true, lastUsedAt: null, createdAt: created.createdAt }, ...(rows ?? [])]);
        pushToast("הטוקן מוכן");
      })
      .catch((error: Error) => pushToast(error.message))
      .finally(() => setBusy(false));
  }

  function download() {
    const blob = new Blob([externalApiGuideMarkdown(base)], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "noa-external-api.md";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-2xl">טוקנים</h2>
        <p className="mt-1 text-muted">כל טוקן פותח את שלוש הקריאות שבמדריך. הוא מוצג פעם אחת, ואחר כך נשאר רק הסימון שלו.</p>
        <form
          className="mt-4 flex flex-wrap items-end gap-2"
          onSubmit={(event) => { event.preventDefault(); createToken(); }}
        >
          <label className="min-w-0 flex-1 text-sm text-muted">שם הטוקן
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="שירה" className="mt-1 w-full rounded-md border border-lineStrong bg-white px-3 py-2 text-ink" />
          </label>
          <button type="submit" disabled={busy || !name.trim()} className="rounded-full bg-brand px-5 py-2 text-onBrand">יצירה</button>
        </form>
        {fresh ? (
          <div className="mt-4 rounded-xl border border-line bg-white p-4">
            <p className="text-sm text-muted">מעתיקים עכשיו. אחרי סגירה אי אפשר להציג אותו שוב.</p>
            <p className="mt-2 break-all font-mono text-sm text-ink" dir="ltr">{fresh}</p>
            <div className="mt-3 flex gap-2">
              <button type="button" className="rounded-full bg-brand px-5 py-2 text-onBrand" onClick={() => navigator.clipboard.writeText(fresh).then(() => pushToast("הועתק"))}>העתקה</button>
              <button type="button" className="rounded-full bg-white px-5 py-2" onClick={() => setFresh(null)}>הסתרה</button>
            </div>
          </div>
        ) : null}
        <div className="mt-4 space-y-2">
          {tokens === null ? <p className="text-muted">טוען</p> : null}
          {tokens?.length === 0 ? <p className="text-muted">עוד אין טוקן.</p> : null}
          {tokens?.map((row) => (
            <article key={row.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-white/80 px-4 py-3">
              <div>
                <p className="font-bold">{row.name}</p>
                <p className="text-sm text-muted">{row.lastUsedAt ? `שימוש אחרון ${when(row.lastUsedAt)}` : "עוד לא בשימוש"} · נוצר {when(row.createdAt)}</p>
              </div>
              <div className="flex items-center gap-3">
                <TokenSwitch
                  on={row.active}
                  label={row.name}
                  onToggle={() => {
                    const active = !row.active;
                    api(`/settings/tokens/${row.id}`, { method: "PATCH", body: JSON.stringify({ active }) })
                      .then(() => setTokens((rows) => rows?.map((item) => item.id === row.id ? { ...item, active } : item) ?? []))
                      .catch((error: Error) => pushToast(error.message));
                  }}
                />
                <button
                  type="button"
                  className="rounded-full bg-[#9B2F45] px-4 py-2 text-sm text-white"
                  onClick={() => {
                    if (!window.confirm("למחוק את הטוקן?")) return;
                    api(`/settings/tokens/${row.id}`, { method: "DELETE" })
                      .then(() => { setTokens((rows) => rows?.filter((item) => item.id !== row.id) ?? []); pushToast("נמחק"); })
                      .catch((error: Error) => pushToast(error.message));
                  }}
                >מחיקה</button>
              </div>
            </article>
          ))}
        </div>
      </section>
      <section>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-2xl">מדריך ה־API</h2>
          <button type="button" onClick={download} className="rounded-full bg-white px-5 py-2">ייצוא Markdown</button>
        </div>
        <article className="mt-4 space-y-3 text-sm leading-6 text-ink">
          {externalApiBlocks(base).map((block, index) => {
            if (block.kind === "h2") return <h3 key={index} className="pt-2 text-lg">{block.text}</h3>;
            if (block.kind === "p") return <p key={index} className="text-muted">{block.text}</p>;
            if (block.kind === "list") return <ul key={index} className="list-disc space-y-1 pe-5 text-muted">{block.items.map((item) => <li key={item}>{item}</li>)}</ul>;
            return <pre key={index} dir="ltr" className="overflow-x-auto rounded-xl border border-line bg-white p-3 text-left text-xs leading-5 text-ink">{block.text}</pre>;
          })}
        </article>
      </section>
    </div>
  );
}

function TokenSwitch({ on, label, onToggle }: { on: boolean; label: string; onToggle: () => void }) {
  return (
    <button type="button" role="switch" dir="ltr" aria-checked={on} aria-label={`${label}, ${on ? "דולק" : "כבוי"}`} onClick={onToggle} className="settings-still flex shrink-0 items-center gap-2">
      <span className={`w-8 text-xs font-bold ${on ? "text-goldInk" : "text-faint"}`}>{on ? "דולק" : "כבוי"}</span>
      <span className={`relative h-8 w-14 rounded-full border transition duration-200 ${on ? "border-brand bg-brand" : "border-lineStrong bg-white"}`}>
        <span className={`absolute top-1 h-6 w-6 rounded-full shadow-sm transition duration-200 ${on ? "left-7 bg-[#F1C968]" : "left-1 bg-[#D6C6B3]"}`} />
      </span>
    </button>
  );
}

function when(value: string) {
  return new Intl.DateTimeFormat("he-IL", { timeZone: "Asia/Jerusalem", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}
