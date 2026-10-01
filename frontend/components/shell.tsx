"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { CalendarDays, LayoutDashboard, LogOut, Plus, Settings, UserPlus, Users } from "lucide-react";
import { FormEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { pushToast, Toaster } from "@/components/toast";
import { useDismiss } from "@/components/dismiss";
import { BackButton } from "@/components/back-button";

const items = [
  { href: "/", label: "ראשי", icon: LayoutDashboard },
  { href: "/calendar", label: "יומן", icon: CalendarDays },
  { href: "/leads", label: "לידים", icon: UserPlus },
  { href: "/clients", label: "לקוחות", icon: Users },
  { href: "/settings", label: "הגדרות", icon: Settings },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [searchOn, setSearchOn] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  const [pill, setPill] = useState<{ y: number; h: number } | null>(null);
  useEffect(() => { if (q) setSearchOn(true); }, [q]);

  useEffect(() => {
    api("/auth/me").catch(() => router.push("/login"));
  }, [router]);

  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const place = () => {
      const active = nav.querySelector<HTMLElement>(".nav-link.active");
      if (!active) return;
      setPill({ y: active.offsetTop, h: active.offsetHeight });
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(nav);
    return () => observer.disconnect();
  }, [path]);

  async function createLead(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await api("/contacts", { method: "POST", body: JSON.stringify({ name: data.get("name"), phone: data.get("phone"), source: data.get("source") }) });
    pushToast("נשמר");
    return true;
  }

  async function logout() {
    await api("/auth/logout", { method: "POST" });
    router.push("/login");
  }

  return (
    <div className="relative h-dvh overflow-hidden">
      <div className="atmosphere" aria-hidden="true" />
      <p className="besiyata">בס״ד</p>
    <div className="relative z-10 flex h-dvh min-h-0 flex-col overflow-hidden lg:grid lg:grid-cols-[248px_1fr]">
      <aside className="studio hidden flex-col px-4 py-6 lg:flex">
        <img src="/logo.jpg" alt="N.T" className="brand-mark mb-8 h-16 w-16 self-center rounded-full transition duration-200 hover:scale-105" />
        <nav ref={navRef} className="nav-rail relative flex flex-col gap-1">
          {pill ? <span className="nav-pill" style={{ transform: `translateY(${pill.y}px)`, height: pill.h }} aria-hidden="true" /> : null}
          {items.map((item) => {
            const Icon = item.icon;
            const active = path === item.href;
            return (
              <Link key={item.href} href={item.href} className={`nav-link flex items-center gap-3 rounded-md px-3 py-3 ${active ? "active" : "text-ink"}`}>
                <Icon size={20} strokeWidth={1.75} />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <button onClick={() => void logout()} className="studio-quiet mt-auto flex items-center gap-3 rounded-md px-3 py-3"><LogOut size={18} /> התנתקות</button>
      </aside>
      <div className="flex h-full min-h-0 flex-col">
        <header className="app-bar relative z-20 flex items-center gap-2 px-3 pb-2 lg:gap-3 lg:px-6 lg:pt-5">
          <button type="button" aria-label="התנתקות" onClick={() => void logout()} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white/80 text-ink lg:hidden"><LogOut size={18} /></button>
          <input value={q} onChange={(event) => setQ(event.target.value)} placeholder="חיפוש לפי שם או טלפון" className="min-w-0 flex-1 rounded-md border border-lineStrong bg-sunken px-4 py-3" />
          <button onClick={() => setOpen(true)} className="flex h-11 shrink-0 items-center gap-2 rounded-full bg-brand px-4 text-onBrand shadow-[0_10px_24px_rgb(82_42_12/22%)] lg:px-5"><Plus size={18} /> חדש</button>
          {searchOn ? <Search q={q} onClose={() => setQ("")} onExited={() => setSearchOn(false)} /> : null}
        </header>
        <div key={path} className={`page-in min-h-0 flex-1 overflow-hidden p-3 pb-[calc(4.75rem+env(safe-area-inset-bottom))] lg:p-6 lg:pb-6${path === "/calendar" ? " page-still" : ""}`}>{children}</div>
      </div>
      <nav className="app-tabs lg:hidden" aria-label="ניווט">
        {items.map((item) => {
          const Icon = item.icon;
          const active = path === item.href;
          return (
            <Link key={item.href} href={item.href} className={active ? "active" : ""}>
              <Icon size={18} strokeWidth={1.75} />
              {item.label}
            </Link>
          );
        })}
      </nav>
      {open ? <LeadModal onClose={() => setOpen(false)} onCreate={createLead} onDone={() => { router.push("/leads"); router.refresh(); }} /> : null}
      <Toaster />
    </div>
    </div>
  );
}

function LeadModal({ onClose, onCreate, onDone }: { onClose: () => void; onCreate: (event: FormEvent<HTMLFormElement>) => Promise<boolean>; onDone: () => void }) {
  const { leaving, requestClose, onAnimationEnd } = useDismiss(onClose);
  return (
    <div className={`modal-bg fixed inset-0 grid place-items-center bg-[rgb(42_21_5/40%)] p-4${leaving ? " out" : ""}`}>
      <form onSubmit={async (event) => { try { const ok = await onCreate(event); if (ok) requestClose(() => { onClose(); onDone(); }); } catch (error) { pushToast(error instanceof Error ? error.message : "לא הצלחנו"); } }} onAnimationEnd={onAnimationEnd} className={`has-back max-h-full w-full max-w-md overflow-y-auto rounded-xl bg-surface p-4 shadow-sheet sm:p-6 ${leaving ? "sheet-out" : "sheet-in"}`}>
        <BackButton onClick={() => requestClose()} />
        <h2 className="mb-4 text-2xl">ליד חדש</h2>
        <input name="name" required placeholder="שם" className="mb-3 w-full rounded-md border border-lineStrong px-3 py-3" />
        <input name="phone" required placeholder="טלפון" className="mb-3 w-full rounded-md border border-lineStrong px-3 py-3" />
        <select name="source" className="mb-4 w-full rounded-md border border-lineStrong px-3 py-3">
          <option>פנייה ישירה לנועה</option>
          <option>מודעה ממומנת</option>
          <option>המלצה מלקוחה</option>
          <option>אינסטגרם אורגני</option>
          <option>אחר</option>
        </select>
        <div className="flex gap-2">
          <button className="rounded-md bg-brand px-4 py-3 text-onBrand">שמירה</button>
          <button type="button" onClick={() => requestClose()} className="rounded-md bg-[#EDE3D6] px-4 py-3">ביטול</button>
        </div>
      </form>
    </div>
  );
}

function Search({ q, onClose, onExited }: { q: string; onClose: () => void; onExited: () => void }) {
  const [items, setItems] = useState<{ id: string; name: string; phone: string; salesStatus: string }[]>([]);
  const { leaving, requestClose, onAnimationEnd } = useDismiss(onExited);
  useEffect(() => { if (!q) requestClose(); }, [q]);
  useEffect(() => {
    if (!q) return;
    const handle = window.setTimeout(() => {
      api<{ items: { id: string; name: string; phone: string; salesStatus: string }[] }>(`/contacts?kind=all&q=${encodeURIComponent(q)}`).then((data) => setItems(data.items)).catch(() => setItems([]));
    }, 180);
    return () => window.clearTimeout(handle);
  }, [q]);
  return (
    <div onAnimationEnd={onAnimationEnd} className={`absolute inset-x-0 top-[calc(100%+8px)] z-30 max-h-[min(20rem,50dvh)] overflow-auto rounded-lg border border-line bg-surface p-2 shadow-pop ${leaving ? "pop-out" : "pop-in"}`}>
      {items.map((item) => (
        <a key={item.id} href={item.salesStatus === "לקוחה פעילה" ? `/clients?open=${item.id}` : `/leads?open=${item.id}`} className="flex flex-col gap-0.5 rounded-md px-3 py-3 hover:bg-sunken sm:flex-row sm:items-center sm:justify-between" onClick={onClose}>
          <span className="min-w-0 break-words">{item.name} · {item.phone}</span>
          <span className="text-[12px] text-faint">{item.salesStatus}</span>
        </a>
      ))}
      {items.length === 0 ? <p className="px-3 py-2 text-muted">אין תוצאות</p> : null}
    </div>
  );
}
