"use client";

import { useEffect } from "react";
import { resumeImport } from "./actions";

/**
 * While Settings is open, keep a stalled import moving (each call starts a
 * fresh background chunk on the server — useful on plans where the cron runs
 * only daily).
 */
export function ImportPump({ accountIds, everySeconds = 45 }: { accountIds: string[]; everySeconds?: number }) {
  // A string key keeps the timer stable across re-renders (the page auto-refreshes).
  const key = accountIds.join(",");
  useEffect(() => {
    const ids = key ? key.split(",") : [];
    if (!ids.length) return;
    const tick = () => ids.forEach((id) => void resumeImport(id).catch(() => undefined));
    const timer = setInterval(tick, everySeconds * 1000);
    return () => clearInterval(timer);
  }, [key, everySeconds]);
  return null;
}
