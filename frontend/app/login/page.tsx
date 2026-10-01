"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState("");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
      await api("/auth/login", { method: "POST", body: JSON.stringify({ username: data.get("username"), password: data.get("password") }) });
      router.push("/calendar");
    } catch (err) {
      setError(err instanceof Error ? err.message : "לא הצלחנו");
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center px-4 py-8">
      <form onSubmit={onSubmit} className="page-in w-full max-w-sm rounded-xl bg-surface p-6 shadow-sheet sm:p-8">
        <img src="/logo.jpg" alt="נועה טורג'מן" className="mx-auto mb-6 h-24 w-24 rounded-full sm:h-28 sm:w-28" />
        <h1 className="mb-6 text-center text-[32px] leading-10">כניסה</h1>
        <label className="mb-3 block text-[13px] font-bold text-muted">שם משתמש
          <input name="username" className="mt-1 w-full rounded-md border border-lineStrong bg-sunken px-3 py-3" />
        </label>
        <label className="mb-4 block text-[13px] font-bold text-muted">סיסמה
          <input name="password" type="password" className="mt-1 w-full rounded-md border border-lineStrong bg-sunken px-3 py-3" />
        </label>
        {error ? <p className="mb-3 text-[#A63D2F]">{error}</p> : null}
        <button className="w-full rounded-md bg-brand py-3 text-onBrand">כניסה</button>
      </form>
    </main>
  );
}
