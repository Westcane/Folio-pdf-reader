import { useCallback, useEffect, useRef, useState } from "react";

/** Panels and an active slider drag keep their controls available. */
export function useReadingChrome(blocked: boolean) {
  const [visible, setVisible] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const activity = useCallback(() => {
    clearTimeout(timer.current);
    if (!blocked) timer.current = setTimeout(() => setVisible(false), 3500);
  }, [blocked]);
  useEffect(() => {
    if (visible) activity();
    return () => clearTimeout(timer.current);
  }, [visible, activity]);
  return { visible, activity,
    show: () => { setVisible(true); activity(); },
    toggle: () => { setVisible((old) => !old); activity(); },
  };
}
