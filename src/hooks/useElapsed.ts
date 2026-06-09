import { useEffect, useState } from "react";

/** `mm:ss` elapsed since `startedAt` (ISO 8601), re-rendering each second.
 *  Returns "" when `startedAt` is null or unparseable. */
export function useElapsed(startedAt: string | null): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!startedAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  if (!startedAt) return "";
  const start = new Date(startedAt).getTime();
  if (Number.isNaN(start)) return "";
  const secs = Math.max(0, Math.floor((now - start) / 1000));
  const mm = Math.floor(secs / 60).toString().padStart(2, "0");
  const ss = (secs % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
}
