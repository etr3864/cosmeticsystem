import { AnimationEvent, useEffect, useRef, useState } from "react";

export function useDismiss(onClose: () => void) {
  const [leaving, setLeaving] = useState(false);
  const leavingRef = useRef(false);
  const closed = useRef(false);
  const finishTo = useRef(onClose);
  const timer = useRef(0);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  function finish() {
    if (closed.current) return;
    closed.current = true;
    leavingRef.current = false;
    window.clearTimeout(timer.current);
    setLeaving(false);
    finishTo.current();
  }

  function requestClose(next?: () => void) {
    if (leavingRef.current) return;
    leavingRef.current = true;
    closed.current = false;
    finishTo.current = next ?? onClose;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      finish();
      return;
    }
    setLeaving(true);
    timer.current = window.setTimeout(finish, 380);
  }

  function onAnimationEnd(event: AnimationEvent<HTMLElement>) {
    if (!leavingRef.current || event.target !== event.currentTarget) return;
    if (!event.animationName.includes("out")) return;
    finish();
  }

  return { leaving, requestClose, onAnimationEnd };
}
