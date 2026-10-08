import { iconButtonClass } from "@/app/(app)/_components/ui";
import { buttonClass } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Sizes of the phone actions (components/booking/phone-actions.tsx). Kept
 * out of that "use client" file so server components can style matching
 * siblings too (an Email / History tile next to Call and WhatsApp).
 * - "icon": round icon button (40px on phones, 28px on desktop) for rows and lists.
 * - "button": labelled secondary button (contact header, Today).
 * - "tile": big iOS action tile (icon over label, 56px tall) for phone cards.
 */
export type PhoneActionSize = "icon" | "button" | "tile";

const tileClass =
  "flex h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl bg-surface-2 px-1 text-[12px] font-medium text-blue-600 transition-colors active:opacity-60 md:h-12 md:rounded-lg md:hover:bg-border/60 dark:text-blue-400";

/** Classes of a phone action of `size` (also for matching Email / History tiles or buttons next to them). */
export function phoneActionClass(size: PhoneActionSize, className?: string): string {
  if (size === "tile") return cn(tileClass, className);
  if (size === "button") return buttonClass("secondary", "md", className);
  return cn(iconButtonClass, className);
}
