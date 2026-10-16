"use client";

import { useEffect, useId, useRef, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Client-side modal: a full-screen iOS sheet on phones (Cancel / title /
 * primary action, slides up, stays inside the visual viewport so the
 * keyboard never covers it) and, on desktop, a centered dialog
 * (variant "dialog") or a right-hand panel (variant "panel"). Rendered in a
 * portal on <body>, so it is never clipped by a table or a sticky bar.
 * Escape, the desktop backdrop, Cancel / Done and × all call `onClose`;
 * sheets can stack (only the top one reacts to Escape and traps Tab).
 */

const PHONE_QUERY = "(max-width: 767px)";

function subscribePhone(onChange: () => void) {
  const mq = window.matchMedia(PHONE_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/** True below the md breakpoint. `serverValue` is the guess used on the server and while hydrating (default false). */
export function useIsPhone(serverValue = false): boolean {
  return useSyncExternalStore(
    subscribePhone,
    () => window.matchMedia(PHONE_QUERY).matches,
    () => serverValue,
  );
}

function subscribeViewport(onChange: () => void) {
  const vv = window.visualViewport;
  if (!vv) return () => {};
  vv.addEventListener("resize", onChange);
  vv.addEventListener("scroll", onChange);
  return () => {
    vv.removeEventListener("resize", onChange);
    vv.removeEventListener("scroll", onChange);
  };
}

/** "top:height" of the visual viewport (a string so the snapshot is stable). */
function viewportSnapshot(): string {
  const vv = window.visualViewport;
  return vv ? `${vv.offsetTop}:${vv.height}` : "";
}

const subscribeNothing = () => () => {};

// Open sheets, bottom to top, and the page scroll lock they share.
const stack: string[] = [];
let lockedOverflow: string | null = null;

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export interface SheetPrimaryAction {
  label: string;
  /** Submit this form (its id) instead of calling onClick. */
  form?: string;
  onClick?: () => void;
  disabled?: boolean;
  /** Shows a spinner and disables the button. */
  pending?: boolean;
}

export function Sheet({
  open,
  onClose,
  title,
  description,
  variant = "dialog",
  primary,
  footer,
  children,
  className,
  bodyClassName,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /** Under the title on desktop; first line of the body on phones. */
  description?: ReactNode;
  /** Desktop shape: centered dialog (default) or right-hand panel. Phones always get a full-screen sheet. */
  variant?: "dialog" | "panel";
  /** Phone header's right button ("Save"). Without it the header shows "Done" (closes). */
  primary?: SheetPrimaryAction;
  /** Desktop-only footer row (put Cancel / Save there; phones use the header). */
  footer?: ReactNode;
  children: ReactNode;
  /** Extra classes for the panel (e.g. a wider desktop panel: "md:w-[40rem]"). */
  className?: string;
  bodyClassName?: string;
}) {
  // Only after hydration: the portal needs document.
  const mounted = useSyncExternalStore(
    subscribeNothing,
    () => true,
    () => false,
  );
  if (!open || !mounted) return null;
  return createPortal(
    <SheetFrame
      onClose={onClose}
      title={title}
      description={description}
      variant={variant}
      primary={primary}
      footer={footer}
      className={className}
      bodyClassName={bodyClassName}
    >
      {children}
    </SheetFrame>,
    document.body,
  );
}

function SheetFrame({
  onClose,
  title,
  description,
  variant,
  primary,
  footer,
  children,
  className,
  bodyClassName,
}: {
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  variant: "dialog" | "panel";
  primary?: SheetPrimaryAction;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  const id = useId();
  const titleId = `${id}-title`;
  const phoneTitleId = `${id}-phone-title`;
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const phone = useIsPhone();
  const viewport = useSyncExternalStore(subscribeViewport, viewportSnapshot, () => "");
  const [vvTop, vvHeight] = viewport ? viewport.split(":").map(Number) : [];
  const phoneStyle = phone && vvHeight ? { top: vvTop, height: vvHeight } : undefined;

  // Stack, scroll lock, focus in / focus back, Escape and Tab.
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    stack.push(id);
    if (stack.length === 1) {
      lockedOverflow = document.documentElement.style.overflow;
      document.documentElement.style.overflow = "hidden";
    }
    const panel = panelRef.current;
    const initial = panel?.querySelector<HTMLElement>("[data-autofocus]");
    (initial ?? panel)?.focus({ preventScroll: true });

    function onKey(event: KeyboardEvent) {
      if (stack[stack.length - 1] !== id || !panel) return;
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (!items.length) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      } else if (!panel.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);

    return () => {
      document.removeEventListener("keydown", onKey);
      const at = stack.indexOf(id);
      if (at !== -1) stack.splice(at, 1);
      if (stack.length === 0) {
        document.documentElement.style.overflow = lockedOverflow ?? "";
        lockedOverflow = null;
      }
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [id]);

  return (
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-labelledby={phone ? phoneTitleId : titleId}>
      <div aria-hidden onClick={onClose} className="absolute inset-0 hidden bg-fg/20 md:block" />
      <div
        ref={panelRef}
        tabIndex={-1}
        style={phoneStyle}
        className={cn(
          // Phone: full-screen sheet on the grouped background.
          "absolute inset-x-0 top-0 flex h-dvh flex-col overflow-hidden bg-bg text-fg outline-none",
          phone && "animate-sheet-up",
          variant === "panel"
            ? "md:inset-y-0 md:left-auto md:right-0 md:h-auto md:w-[min(32rem,100vw)] md:border-l md:border-border md:bg-surface md:shadow-2xl"
            : "md:inset-x-auto md:left-1/2 md:top-[max(2rem,8vh)] md:h-auto md:max-h-[calc(100dvh-4rem)] md:w-[min(30rem,calc(100vw-2rem))] md:-translate-x-1/2 md:rounded-xl md:border md:border-border md:bg-surface md:shadow-2xl",
          className,
        )}
      >
        {/* Phone header: Cancel / title / primary (or just Done). */}
        <header className="grid shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-2 border-b border-border bg-bg/90 px-4 pb-2 pt-[calc(env(safe-area-inset-top)+0.5rem)] backdrop-blur-xl md:hidden">
          {primary ? (
            <button type="button" onClick={onClose} className="flex h-11 items-center justify-self-start text-[17px] text-fg/80 active:opacity-60">
              Cancel
            </button>
          ) : (
            <span />
          )}
          <h2 id={phoneTitleId} className="max-w-[14rem] truncate text-[17px] font-semibold">
            {title}
          </h2>
          {primary ? (
            <button
              type={primary.form ? "submit" : "button"}
              form={primary.form}
              onClick={primary.form ? undefined : primary.onClick}
              disabled={primary.disabled || primary.pending}
              className="flex h-11 items-center gap-1.5 justify-self-end text-[17px] font-semibold text-blue-600 active:opacity-60 disabled:opacity-50 dark:text-blue-400"
            >
              {primary.pending ? <Loader2 className="size-4 animate-spin" /> : null}
              {primary.label}
            </button>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="flex h-11 items-center justify-self-end text-[17px] font-semibold text-blue-600 active:opacity-60 dark:text-blue-400"
            >
              Done
            </button>
          )}
        </header>

        {/* Desktop header: title, description, ×. */}
        <header className="hidden shrink-0 items-start justify-between gap-3 border-b border-border px-5 py-3 md:flex">
          <div className="min-w-0">
            <h2 id={titleId} className="truncate text-sm font-semibold text-fg">
              {title}
            </h2>
            {description ? <div className="mt-0.5 text-xs text-muted">{description}</div> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            title="Close (Esc)"
            className="-mr-1.5 inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-fg"
          >
            <X className="size-4" strokeWidth={1.75} />
          </button>
        </header>

        <div
          className={cn(
            "min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] pt-4 md:px-5 md:pb-5",
            bodyClassName,
          )}
        >
          {description ? <div className="mb-4 text-[13px] text-muted md:hidden">{description}</div> : null}
          {children}
        </div>

        {footer ? (
          <footer className="hidden shrink-0 items-center justify-end gap-2 border-t border-border px-5 py-3 md:flex">{footer}</footer>
        ) : null}
      </div>
    </div>
  );
}
