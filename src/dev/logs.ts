export interface DebugLog {
  time: string;
  level: string;
  message: string;
}
const logs: DebugLog[] = [];
const listeners = new Set<() => void>();
export const getLogs = () => logs.slice();
export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function clearLogs() {
  logs.length = 0;
  listeners.forEach((fn) => fn());
}
let installed = false;
export function installErrorCapture() {
  if (installed) return;
  installed = true;
  const record = (level: string, values: unknown[]) => {
    logs.push({
      time: new Date().toLocaleTimeString(),
      level,
      message: values
        .map((value) =>
          value instanceof Error
            ? `${value.name}: ${value.message}\n${value.stack ?? ""}`
            : String(value),
        )
        .join(" ")
        .slice(0, 2500),
    });
    if (logs.length > 80) logs.shift();
    listeners.forEach((fn) => fn());
  };
  for (const level of ["error", "warn"] as const) {
    const original = console[level].bind(console);
    console[level] = (...values: unknown[]) => {
      record(level, values);
      original(...values);
    };
  }
  window.addEventListener("error", (event) =>
    record("error", [event.error || event.message]),
  );
  window.addEventListener("unhandledrejection", (event) =>
    record("promise", [event.reason]),
  );
}
