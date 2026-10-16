"use client";

import { useRouter } from "next/navigation";
import { startTransition, useEffect } from "react";

const CHECK_EVERY_MS = 30_000;

/**
 * New mail shows up without touching anything: while the list is visible it
 * checks a small fingerprint of the mailboxes every 30 seconds (and when the
 * app comes back to the foreground) and re-reads the page only when it changed.
 */
export function MailAutoRefresh() {
  const router = useRouter();
  useEffect(() => {
    let stamp: string | null = null;
    let busy = false;
    const check = async () => {
      if (busy || document.visibilityState !== "visible") return;
      busy = true;
      try {
        const response = await fetch("/api/mail/state", { cache: "no-store" });
        if (!response.ok) return;
        const next = ((await response.json()) as { stamp: string }).stamp;
        if (stamp !== null && next !== stamp) startTransition(() => router.refresh());
        stamp = next;
      } catch {
        // Offline: try again at the next tick.
      } finally {
        busy = false;
      }
    };
    void check();
    const id = window.setInterval(check, CHECK_EVERY_MS);
    const onVisible = () => void check();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router]);
  return null;
}
