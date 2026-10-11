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

/** Floating Compose button above the phone tab bar, like Gmail for iPhone. */
export function ComposeFab({ account }: { account: string | null }) {
  const { compose } = useMail();
  return (
    <button
      type="button"
      onClick={() => compose({ accountId: account })}
      aria-label="Compose"
      className="fixed bottom-[calc(env(safe-area-inset-bottom)+4.75rem)] right-4 z-20 flex h-14 items-center gap-3 rounded-2xl bg-[#c2e7ff] pl-5 pr-6 text-[17px] font-medium text-[#001d35] shadow-[0_2px_6px_rgba(0,0,0,0.2)] active:scale-95 active:opacity-90 dark:bg-[#0b57d0] dark:text-white md:hidden"
    >
      <Pencil className="size-[22px]" strokeWidth={1.75} />
      Compose
    </button>
  );
}
