"use client";

import { useId, useState, type ReactNode } from "react";
import { Sheet } from "@/components/ui/sheet";
import type { ListingEvent, ListingPlatform } from "@/lib/queries/listings";
import { cn } from "@/lib/utils";
import { EventForm, PlatformForm } from "./forms";

/**
 * A list row that opens a form in a sheet (full screen with Cancel / Save on
 * phones, a dialog on desktop) instead of expanding in place.
 */
function SheetRow({
  label,
  icon,
  title,
  tone = "action",
  children,
}: {
  label: ReactNode;
  icon?: ReactNode;
  title: string;
  /** "action": blue text (Add…); "plain": a regular row (Edit…). */
  tone?: "action" | "plain";
  children: (formId: string, close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const formId = `${useId()}-form`;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "flex min-h-[52px] w-full items-center gap-3 px-4 text-left text-[17px] active:bg-surface-2 md:min-h-11 md:text-sm md:hover:bg-surface-2",
          tone === "action" ? "text-blue-600 dark:text-blue-400" : "text-fg",
        )}
      >
        {icon}
        <span className="flex-1">{label}</span>
      </button>
      {open ? (
        <Sheet open onClose={() => setOpen(false)} title={title} primary={{ label: "Save", form: formId }}>
          {children(formId, () => setOpen(false))}
        </Sheet>
      ) : null}
    </>
  );
}

export function EventSheetRow({ event, label, icon, tone }: { event?: ListingEvent; label: ReactNode; icon?: ReactNode; tone?: "action" | "plain" }) {
  return (
    <SheetRow label={label} icon={icon} tone={tone} title={event ? "Concert details" : "New concert"}>
      {(id, close) => <EventForm event={event} id={id} onDone={close} />}
    </SheetRow>
  );
}

export function PlatformSheetRow({ platform, label, icon, tone }: { platform?: ListingPlatform; label: ReactNode; icon?: ReactNode; tone?: "action" | "plain" }) {
  return (
    <SheetRow label={label} icon={icon} tone={tone} title={platform ? platform.name : "New site"}>
      {(id, close) => <PlatformForm platform={platform} id={id} onDone={close} />}
    </SheetRow>
  );
}
