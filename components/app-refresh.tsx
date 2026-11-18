"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

/** Reload the whole app: fresh data and, after a deploy, the new version of the code. */
export function reloadApp() {
  window.location.reload();
}

/**
 * Keeps the app on the Home Screen fresh, where there is no reload button:
 * - coming back to the app after a while: fresh data, and a full reload when a
 *   new version was deployed meanwhile;
 * - pull down from the top of the page to reload, as in iPhone apps.
 */
export function AppRefresh({ version }: { version: string }) {
  const router = useRouter();
  const hiddenAt = useRef<number | null>(null);
  const [pull, setPull] = useState(0);
  const [reloading, setReloading] = useState(false);
  const start = useRef<{ y: number; x: number } | null>(null);

  useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        const { version: live } = (await res.json()) as { version?: string };
        if (live && version !== "dev" && live !== version) {
          window.location.reload();
          return true;
        }
      } catch {
        // Offline: keep what is on screen.
      }
      return false;
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt.current = Date.now();
        return;
      }
      const away = hiddenAt.current ? Date.now() - hiddenAt.current : 0;
      hiddenAt.current = null;
      void check().then((reloaded) => {
        if (!reloaded && away > 30_000) router.refresh();
      });
    };
    document.addEventListener("visibilitychange", onVisibility);
    // A deploy while the app stays open: check every 10 minutes.
    const timer = setInterval(() => document.visibilityState === "visible" && void check(), 10 * 60_000);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      clearInterval(timer);
    };
  }, [router, version]);

  // Pull to refresh (touch screens): only when the page is scrolled to the top and nothing is open.
  useEffect(() => {
    const THRESHOLD = 80;
    const onStart = (e: TouchEvent) => {
      if (window.scrollY > 0 || e.touches.length !== 1 || document.querySelector("[role=dialog]")) {
        start.current = null;
        return;
      }
      start.current = { y: e.touches[0].clientY, x: e.touches[0].clientX };
    };
    const onMove = (e: TouchEvent) => {
      if (!start.current) return;
      const dy = e.touches[0].clientY - start.current.y;
      const dx = Math.abs(e.touches[0].clientX - start.current.x);
      if (dy <= 0 || dx > dy || window.scrollY > 0) {
        setPull(0);
        return;
      }
      setPull(Math.min(120, dy * 0.5));
    };
    const onEnd = () => {
      if (!start.current) return;
      start.current = null;
      setPull((p) => {
        if (p >= THRESHOLD * 0.5 + 20) {
          setReloading(true);
          reloadApp();
        }
        return 0;
      });
    };
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", onEnd);
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, []);

  const shown = reloading || pull > 8;
  if (!shown) return null;
  const ready = reloading || pull >= 60;
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+0.5rem)] z-[70] flex justify-center"
      style={{ transform: `translateY(${reloading ? 24 : pull * 0.6}px)` }}
    >
      <span className={cn("flex size-10 items-center justify-center rounded-full border border-border bg-surface shadow-lg", ready ? "text-brand" : "text-muted")}>
        <RefreshCw className={cn("size-5", reloading && "animate-spin")} style={reloading ? undefined : { transform: `rotate(${pull * 3}deg)` }} />
      </span>
    </div>
  );
}

/** A visible "Refresh" button (More page, settings). */
export function RefreshButton({ className }: { className?: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        setBusy(true);
        reloadApp();
      }}
      className={className}
    >
      <RefreshCw className={cn("size-5 text-muted", busy && "animate-spin")} aria-hidden />
      <span>{busy ? "Refreshing…" : "Refresh the app"}</span>
    </button>
  );
}
