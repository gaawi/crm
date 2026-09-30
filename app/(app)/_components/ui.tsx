import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { ChevronLeft, Plus, Search } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { cn } from "@/lib/utils";

/** Row style for links/buttons inside a Dropdown menu. */
export const menuItemClass =
  "flex h-11 w-full items-center gap-2.5 rounded-lg px-3 text-left text-[15px] text-fg active:bg-surface-2 md:h-8 md:rounded-md md:px-2.5 md:text-sm md:hover:bg-surface-2";

/** Round icon-only button (44pt on phones, compact on desktop). */
export const iconButtonClass =
  "inline-flex size-10 shrink-0 items-center justify-center rounded-full text-subtle transition-colors active:bg-surface-2 md:size-7 md:rounded-md md:hover:bg-surface-2 md:hover:text-fg";

/** "‹ Contacts" link, same look as PageHeader's back link, for custom headers. */
export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="-ml-1.5 flex h-9 w-fit min-w-0 items-center text-[17px] text-fg/80 active:opacity-60 md:h-auto md:text-sm md:text-muted md:hover:text-fg"
    >
      <ChevronLeft className="size-6 shrink-0 md:size-4" strokeWidth={2} />
      <span className="truncate">{label}</span>
    </Link>
  );
}

/** Search input with a leading icon (put it inside a FilterForm or GET form). */
export function SearchInput({ className, ...props }: ComponentProps<"input">) {
  return (
    <div className={cn("relative min-w-0", className)}>
      <Search
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle md:left-2.5 md:size-3.5"
        strokeWidth={1.75}
        aria-hidden
      />
      <Input type="search" enterKeyHint="search" autoComplete="off" className="pl-9 md:pl-8" {...props} />
    </div>
  );
}

/**
 * Buttons at the end of a form: full width and stacked on phones (primary
 * first), a compact row on desktop.
 */
export function FormActions({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 pt-2 md:flex-row md:items-center md:pt-1 [&>*]:w-full md:[&>*]:w-auto",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Grouped section heading in the iOS settings style (small caps above an inset list). */
export function GroupTitle({ children, actions, className }: { children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cn("mb-1.5 flex min-h-7 items-end justify-between gap-3 px-4 md:mb-2 md:min-h-0 md:px-0", className)}>
      <h2 className="text-[13px] uppercase tracking-wide text-subtle md:text-xs md:font-medium">{children}</h2>
      {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
    </div>
  );
}

/** Text link used in group titles ("Edit", "Add"). */
export function GroupAction({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      scroll={false}
      className="inline-flex h-7 items-center gap-1 text-[15px] text-fg/80 active:opacity-60 md:h-auto md:text-xs md:text-muted md:hover:text-fg"
    >
      {children}
    </Link>
  );
}

/**
 * "New …" action for a PageHeader: a labelled primary button on desktop, a
 * plain "+" in the navigation-bar style on phones.
 */
export function HeaderAddButton({ href, label }: { href: string; label: string }) {
  return (
    <>
      <Link
        href={href}
        aria-label={label}
        title={label}
        className="-mr-2 inline-flex size-11 items-center justify-center rounded-full text-fg active:opacity-60 md:hidden"
      >
        <Plus className="size-7" strokeWidth={1.75} />
      </Link>
      <ButtonLink href={href} variant="primary" className="hidden md:inline-flex">
        <Plus className="size-4" strokeWidth={1.75} />
        {label}
      </ButtonLink>
    </>
  );
}
