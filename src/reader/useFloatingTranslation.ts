import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

interface Position { x: number; y: number }
const storageKey = "folio-floating-translation";
const inset = 24;
const buttonSize = 48;
function clamp(position: Position): Position {
  return { x: Math.max(inset, Math.min(window.innerWidth - buttonSize - inset, position.x)),
    y: Math.max(76, Math.min(window.innerHeight - buttonSize - inset, position.y)) };
}

/** Only a deliberate long press captures the pointer; an ordinary tap still translates. */
export function useFloatingTranslation() {
  const [position, setPosition] = useState<Position | null>(null);
  const [dragging, setDragging] = useState(false);
  const gesture = useRef<{ x: number; y: number; start: Position; id: number; element: HTMLButtonElement; active: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const suppressClick = useRef(false);
  const latest = useRef(position);
  latest.current = position;
  useEffect(() => {
    try { const value = JSON.parse(localStorage.getItem(storageKey) || "null"); if (value && Number.isFinite(value.x) && Number.isFinite(value.y)) setPosition(clamp(value)); } catch { /* Position persistence is optional. */ }
    const resize = () => setPosition((old) => old ? clamp(old) : old);
    window.addEventListener("resize", resize);
    return () => { clearTimeout(timer.current); window.removeEventListener("resize", resize); };
  }, []);
  const finish = (event: ReactPointerEvent<HTMLButtonElement>) => {
    clearTimeout(timer.current);
    const current = gesture.current;
    if (!current || current.id !== event.pointerId) return;
    if (current.active) {
      suppressClick.current = true;
      if (current.element.hasPointerCapture(current.id)) current.element.releasePointerCapture(current.id);
      try { localStorage.setItem(storageKey, JSON.stringify(latest.current)); } catch { /* Storage can be unavailable. */ }
    }
    gesture.current = null; setDragging(false);
  };
  return { position, dragging,
    consumeDrag: () => { const result = suppressClick.current; suppressClick.current = false; return result; },
    onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) return;
      suppressClick.current = false;
      const rect = event.currentTarget.getBoundingClientRect();
      const current = { x: event.clientX, y: event.clientY, start: { x: rect.left, y: rect.top }, id: event.pointerId, element: event.currentTarget, active: false };
      gesture.current = current;
      timer.current = setTimeout(() => {
        if (gesture.current !== current) return;
        current.active = true; suppressClick.current = true;
        current.element.setPointerCapture(current.id); setPosition(clamp(current.start)); setDragging(true);
      }, 420);
    },
    onPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => {
      const current = gesture.current;
      if (!current || current.id !== event.pointerId) return;
      const dx = event.clientX - current.x, dy = event.clientY - current.y;
      if (!current.active) { if (Math.hypot(dx, dy) > 9) { clearTimeout(timer.current); gesture.current = null; suppressClick.current = true; } return; }
      event.preventDefault();
      const next = clamp({ x: current.start.x + dx, y: current.start.y + dy });
      latest.current = next; setPosition(next);
    },
    onPointerUp: finish, onPointerCancel: finish,
  };
}
