"use client";

import { useEffect, useState } from "react";

export function pushToast(message: string) {
  window.dispatchEvent(new CustomEvent("nt-toast", { detail: message }));
}

export function Toaster() {
  const [items, setItems] = useState<{ id: number; message: string }[]>([]);
  useEffect(() => {
    const onToast = (event: Event) => {
      const message = (event as CustomEvent<string>).detail;
      const id = Date.now() + Math.random();
      setItems((current) => [...current, { id, message }]);
      window.setTimeout(() => setItems((current) => current.filter((item) => item.id !== id)), 2800);
    };
    window.addEventListener("nt-toast", onToast);
    return () => window.removeEventListener("nt-toast", onToast);
  }, []);
  return (
    <div className="toast-stack">
      {items.map((item) => <div key={item.id} className="toast">{item.message}</div>)}
    </div>
  );
}
