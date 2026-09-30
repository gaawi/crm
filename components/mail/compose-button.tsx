"use client";

import { Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMail } from "./mail-provider";

/** Gmail's Compose button (sidebar) — an icon in the rail, labelled when wide. */
export function ComposeButton({ account, className, labelClassName }: { account: string | null; className?: string; labelClassName?: string }) {
  const { compose } = useMail();
  return (
    <button
      type="button"
      onClick={() => compose({ accountId: account })}
      title="Compose (c)"
      aria-label="Compose"
      className={cn(
        "inline-flex h-12 w-12 items-center justify-center gap-3 rounded-2xl bg-blue-100 text-sm font-medium text-blue-950 shadow-sm transition-shadow hover:shadow-md dark:bg-blue-950 dark:text-blue-100",
        className,
      )}
    >
      <Pencil className="size-5 shrink-0" strokeWidth={1.75} />
      <span className={labelClassName}>Compose</span>
    </button>
  );
}

/** Floating Compose button above the phone tab bar (iPhone Mail's compose, Gmail's FAB). */
export function ComposeFab({ account }: { account: string | null }) {
  const { compose } = useMail();
  return (
    <button
      type="button"
      onClick={() => compose({ accountId: account })}
      aria-label="Compose"
      className="fixed bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] right-4 z-20 flex h-14 items-center gap-2 rounded-2xl bg-blue-600 pl-4 pr-5 text-[17px] font-semibold text-white shadow-lg shadow-blue-900/25 active:scale-95 active:opacity-90 md:hidden"
    >
      <Pencil className="size-5" strokeWidth={2} />
      Compose
    </button>
  );
}
