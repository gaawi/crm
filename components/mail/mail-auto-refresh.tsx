"use client";

import { useRouter } from "next/navigation";
import { startTransition, useEffect } from "react";

const EVERY_MS = 60_000;
const ON_RETURN_AFTER_MS = 20_000;

/**
 * New mail shows up without touching anything: the list re-reads the server
 * every minute while the page is visible, and right away when the app comes
 * back to the foreground after a while.
 */
export function MailAutoRefresh() {
  const router = useRouter();
  useEffect(() => {
    let last = Date.now();
    const refresh = () => {
      last = Date.now();
      startTransition(() => router.refresh());
    };
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible" && Date.now() - last >= EVERY_MS - 1000) refresh();
    }, EVERY_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - last >= ON_RETURN_AFTER_MS) refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router]);
  return null;
}
