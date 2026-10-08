"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { CircleAlert, X } from "lucide-react";
import { cn } from "@/lib/utils";

/** The sheet's toast (same look as Mail's): results of Prepare email, bulk changes. */
export interface SheetToast {
  message: string;
  /** Second line (e.g. why rows were skipped). */
  detail?: string;
  tone?: "default" | "error";
  link?: { label: string; href: string };
}

let nextId = 1;

export function useSheetToast({ raised }: { raised: boolean }): { show: (toast: SheetToast) => void; node: ReactNode } {
  const [toast, setToast] = useState<(SheetToast & { id: number }) | null>(null);
  const show = useCallback((t: SheetToast) => setToast({ ...t, id: nextId++ }), []);
  const dismiss = useCallback(() => setToast(null), []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(dismiss, toast.tone === "error" || toast.detail ? 10_000 : 6000);
    return () => window.clearTimeout(timer);
  }, [toast, dismiss]);

  const node = (
    <div
      aria-live="polite"
      className={cn(
        "pointer-events-none fixed inset-x-4 z-[70] flex justify-center md:inset-x-auto md:bottom-6 md:left-6 md:justify-start",
        // Above the tab bar, and above the bulk bar while rows are selected.
        raised ? "bottom-[calc(env(safe-area-inset-bottom)+10rem)] md:bottom-20" : "bottom-[calc(env(safe-area-inset-bottom)+4.5rem)]",
      )}
    >
      {toast ? (
        <div
          key={toast.id}
          role={toast.tone === "error" ? "alert" : "status"}
          className={cn(
            "pointer-events-auto flex max-w-md items-start gap-3 rounded-2xl px-4 py-3 text-[15px] shadow-xl md:rounded-lg md:py-2.5 md:text-sm",
            toast.tone === "error" ? "bg-red-600 text-white dark:bg-red-700" : "bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900",
          )}
        >
          {toast.tone === "error" ? <CircleAlert className="mt-0.5 size-4 shrink-0" strokeWidth={2} /> : null}
          <span className="min-w-0 flex-1">
            {toast.message}
            {toast.detail ? <span className="mt-0.5 block text-[13px] opacity-75 md:text-xs">{toast.detail}</span> : null}
          </span>
          {toast.link ? (
            <Link
              href={toast.link.href}
              onClick={dismiss}
              className={cn(
                "shrink-0 font-semibold active:opacity-60 md:hover:underline",
                toast.tone === "error" ? "text-white underline" : "text-blue-300 dark:text-blue-700",
              )}
            >
              {toast.link.label}
            </Link>
          ) : null}
          <button type="button" onClick={dismiss} aria-label="Dismiss" className="-mr-1 shrink-0 rounded p-1 opacity-70 hover:opacity-100">
            <X className="size-4" strokeWidth={2} />
          </button>
        </div>
      ) : null}
    </div>
  );
  return { show, node };
}
