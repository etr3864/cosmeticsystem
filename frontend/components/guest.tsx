"use client";

import type { ReactNode } from "react";

export type Clinic = { address: string; unit: string; parking: string };

export function firstOf(name: string) {
  return name.trim().split(/\s+/)[0] || name;
}

export function guestWhen(iso: string) {
  return new Date(iso).toLocaleString("he-IL", {
    timeZone: "Asia/Jerusalem",
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function guestDay(iso: string) {
  return new Date(iso).toLocaleDateString("he-IL", {
    timeZone: "Asia/Jerusalem",
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

export function guestClock(iso: string) {
  return new Date(iso).toLocaleTimeString("he-IL", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit" });
}

export function GuestScreen({ children }: { children: ReactNode }) {
  return (
    <main className="guest-page mx-auto flex min-h-dvh w-full max-w-lg flex-col px-4 py-10 sm:px-5 sm:py-12">
      <p className="guest-mark">בס״ד</p>
      {children}
    </main>
  );
}

export function GuestHero({ kicker, title, children }: { kicker: string; title: string; children?: ReactNode }) {
  return (
    <header className="guest-rise text-center">
      <img src="/logo.jpg" alt="" className="mx-auto h-[72px] w-[72px] rounded-full shadow-pop ring-4 ring-white" />
      <p className="mt-5 text-sm font-bold text-goldInk">{kicker}</p>
      <h1 className="mt-1 break-words text-[32px] leading-[1.15] text-ink sm:text-[40px]">{title}</h1>
      <div className="gold-rule mx-auto mt-4 w-24" />
      {children}
    </header>
  );
}

export function GuestNote({ children }: { children: ReactNode }) {
  return <div className="mt-4 text-center text-base leading-7 text-muted">{children}</div>;
}
