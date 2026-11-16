"use client";

import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { VelaLoader } from "@/components/brand/vela-logo";

/**
 * Immediate feedback after tapping a link: a bar at the top and, if it takes
 * a moment, a small "Opening…" pill above the tab bar. Some pages (a big
 * campaign) take a few seconds on the server, and without this a tap looked
 * like it did nothing. Clears when the new page is shown.
 */
export function NavProgress() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const here = `${pathname}?${search}`;
  // The page the tap happened on: the indicator shows until the page changes.
  const [from, setFrom] = useState<string | null>(null);
  // Once the new page is shown, forget the tap (so coming back later doesn't show it again).
  if (from !== null && from !== here) setFrom(null);
  const pending = from === here;

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
      if (url.pathname === location.pathname && url.search === location.search) return;
      setFrom(`${location.pathname}?${location.search.replace(/^\?/, "")}`);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => setFrom(null), 20_000);
    return () => clearTimeout(t);
  }, [pending]);

  if (!pending) return null;
  return (
    <>
      <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-[3px] overflow-hidden bg-brand/15">
        <div className="nav-progress-bar h-full w-1/3 bg-brand" />
      </div>
      <div className="nav-progress-pill pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+5rem)] z-[60] flex justify-center md:bottom-6">
        <span className="flex items-center gap-2 rounded-full border border-border bg-surface px-3.5 py-2 text-sm text-muted shadow-lg">
          <VelaLoader size={18} className="text-brand" label="Opening" /> Opening…
        </span>
      </div>
    </>
  );
}
