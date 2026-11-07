import { useEffect, useRef, type MouseEvent, type PointerEvent } from "react";

const doubleTapMs = 300;
const interactive = "button, [role='button'], a, input, select, textarea, summary";
interface Tap { x: number; y: number; at: number }

/** Delay single taps just enough to distinguish a double tap without translating twice. */
export function useReadingGestures(onTap: (target: HTMLElement, x: number) => void, onDoubleTap: () => void) {
  const callbacks = useRef({ onTap, onDoubleTap });
  callbacks.current = { onTap, onDoubleTap };
  const pointer = useRef<Tap | undefined>(undefined);
  const pending = useRef<Tap | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cancel = () => { clearTimeout(timer.current); pending.current = undefined; pointer.current = undefined; };
  useEffect(() => () => clearTimeout(timer.current), []);
  return {
    onPointerDownCapture: (event: PointerEvent<HTMLDivElement>) => {
      pointer.current = event.isPrimary && event.button === 0 ? { x: event.clientX, y: event.clientY, at: Date.now() } : undefined;
    },
    onPointerCancel: cancel,
    onScroll: cancel,
    onClick: (event: MouseEvent<HTMLDivElement>) => {
      const start = pointer.current; pointer.current = undefined;
      const target = event.target as HTMLElement;
      if (target.closest(interactive)) return;
      if (!start || Date.now() - start.at > 350 || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 9) return;
      const previous = pending.current;
      if (previous && Date.now() - previous.at <= doubleTapMs && Math.hypot(event.clientX - previous.x, event.clientY - previous.y) < 24) {
        cancel(); event.preventDefault(); window.getSelection()?.removeAllRanges();
        callbacks.current.onDoubleTap(); return;
      }
      if (window.getSelection()?.toString()) return;
      clearTimeout(timer.current);
      pending.current = { x: event.clientX, y: event.clientY, at: Date.now() };
      const rect = event.currentTarget.getBoundingClientRect(), x = (event.clientX - rect.left) / rect.width;
      timer.current = setTimeout(() => { pending.current = undefined; callbacks.current.onTap(target, x); }, doubleTapMs);
    },
    // The double tap above owns this gesture; native long-press selection remains available.
    onDoubleClick: (event: MouseEvent<HTMLDivElement>) => event.preventDefault(),
  };
}
