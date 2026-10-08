"use client";

import type { ReactNode } from "react";
import { MessageCircle, Phone } from "lucide-react";
import { buttonClass } from "@/components/ui/button";
import { formatPhone, telHref, whatsappNumber, whatsappUrl } from "@/lib/booking/phone";
import { cn } from "@/lib/utils";
import { useActivityLogger, type ActivityTarget, type LoggedActivity } from "./log-activity-dialog";
import { phoneActionClass, type PhoneActionSize } from "./phone-action-class";

export type { PhoneActionSize };

/**
 * Call and WhatsApp buttons. Links are built only from normalized numbers
 * (telHref / whatsappUrl), so nothing but digits and "+" reaches an href.
 * Sizes ("icon" | "button" | "tile") are described in ./phone-action-class;
 * use phoneActionClass("tile") from there for sibling tiles (Email, History)
 * so they match, from server or client components.
 *
 * Tapping Call keeps the tel: link working and, right after, runs `onCall`
 * (open the log-call dialog there), so the dialog is waiting when the owner
 * comes back from the call. <PhoneActions> does that wiring by itself.
 */

const missingClass = "pointer-events-none opacity-40";

/** Delay before onCall / onOpen, so the dialer or WhatsApp opens first. */
const AFTER_TAP_MS = 150;

function ActionContent({ size, icon, label }: { size: PhoneActionSize; icon: ReactNode; label: string }) {
  if (size === "icon") return <>{icon}</>;
  return (
    <>
      {icon}
      <span className={size === "tile" ? "max-w-full truncate" : undefined}>{label}</span>
    </>
  );
}

const iconSize: Record<PhoneActionSize, string> = {
  icon: "size-[18px] md:size-4",
  button: "size-4",
  tile: "size-5 md:size-[18px]",
};

/** tel: link. Renders nothing without a valid number (or a dimmed button with whenMissing="disabled"). */
export function CallButton({
  phone,
  onCall,
  size = "icon",
  label = "Call",
  showNumber = false,
  whenMissing = "hide",
  prominent = false,
  className,
}: {
  /** Stored (normalized) number; anything else is normalized or ignored. */
  phone: string | null | undefined;
  /** Runs right after the tap; the call itself still starts. Open the log-call dialog here. */
  onCall?: () => void;
  size?: PhoneActionSize;
  label?: string;
  /** "button" size: show "+34 612 345 678" instead of the label. */
  showNumber?: boolean;
  whenMissing?: "hide" | "disabled";
  /** A filled primary button whatever the size (the next step is a call): round on phones, labelled on desktop. */
  prominent?: boolean;
  className?: string;
}) {
  const href = telHref(phone);
  const icon = <Phone className={iconSize[size]} strokeWidth={1.75} aria-hidden />;
  if (prominent && href) {
    const number = formatPhone(href.slice("tel:".length));
    return (
      <a
        href={href}
        onClick={() => {
          if (onCall) window.setTimeout(onCall, AFTER_TAP_MS);
        }}
        aria-label={`${label} ${number}`}
        title={`${label} ${number}`}
        className={buttonClass("primary", "md", cn("w-11 shrink-0 rounded-full px-0 md:w-auto md:rounded-md md:px-3", className))}
      >
        <Phone className="size-[18px] md:size-4" strokeWidth={2} aria-hidden />
        {/* Phones: a filled round button (room for the title); desktop: labelled. */}
        <span className="hidden md:inline">{label}</span>
      </a>
    );
  }
  if (!href) {
    if (whenMissing === "hide") return null;
    return (
      <span aria-disabled="true" title="No phone number" className={phoneActionClass(size, cn(missingClass, className))}>
        <ActionContent size={size} icon={icon} label={label} />
      </span>
    );
  }
  const number = formatPhone(href.slice("tel:".length));
  return (
    <a
      href={href}
      onClick={() => {
        if (onCall) window.setTimeout(onCall, AFTER_TAP_MS);
      }}
      aria-label={`${label} ${number}`}
      title={`${label} ${number}`}
      className={phoneActionClass(size, className)}
    >
      <ActionContent size={size} icon={icon} label={showNumber && size === "button" ? number : label} />
    </a>
  );
}

/**
 * wa.me link (new tab / the WhatsApp app): the contact's WhatsApp number, or
 * their phone when it can have WhatsApp (Spanish mobile, other international).
 */
export function WhatsAppButton({
  contact,
  text,
  onOpen,
  size = "icon",
  label = "WhatsApp",
  whenMissing = "hide",
  className,
}: {
  contact: { phone?: string | null; whatsapp?: string | null } | null | undefined;
  /** Prefilled message. */
  text?: string;
  /** Runs right after the tap (open the log dialog with kind "whatsapp" here). */
  onOpen?: () => void;
  size?: PhoneActionSize;
  label?: string;
  whenMissing?: "hide" | "disabled";
  className?: string;
}) {
  const url = whatsappUrl(contact);
  const icon = (
    <MessageCircle
      className={cn(iconSize[size], size !== "tile" && "text-emerald-600 dark:text-emerald-400")}
      strokeWidth={1.75}
      aria-hidden
    />
  );
  if (!url) {
    if (whenMissing === "hide") return null;
    return (
      <span aria-disabled="true" title="No WhatsApp number" className={phoneActionClass(size, cn(missingClass, className))}>
        <ActionContent size={size} icon={icon} label={label} />
      </span>
    );
  }
  const number = formatPhone(whatsappNumber(contact));
  return (
    <a
      href={text ? `${url}?text=${encodeURIComponent(text)}` : url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => {
        if (onOpen) window.setTimeout(onOpen, AFTER_TAP_MS);
      }}
      aria-label={`${label} ${number}`}
      title={`${label} ${number}`}
      className={phoneActionClass(size, className)}
    >
      <ActionContent size={size} icon={icon} label={label} />
    </a>
  );
}

/** The number as text, linked to tel: ("+34 612 345 678"). Nothing without a valid number. */
export function PhoneLink({
  phone,
  onCall,
  className,
}: {
  phone: string | null | undefined;
  onCall?: () => void;
  className?: string;
}) {
  const href = telHref(phone);
  if (!href) return null;
  return (
    <a
      href={href}
      onClick={() => {
        if (onCall) window.setTimeout(onCall, AFTER_TAP_MS);
      }}
      className={cn("tabular-nums underline-offset-2 hover:underline", className)}
    >
      {formatPhone(href.slice("tel:".length))}
    </a>
  );
}

/**
 * Call + WhatsApp for one contact, with the log dialog built in: after a tap
 * it opens on `target` (kind call / whatsapp). Drop it into server-rendered
 * pages (Today, the contact page, the organization page) as is; all props
 * are serializable except onLogged.
 */
export function PhoneActions({
  phone,
  whatsapp,
  target,
  timezone,
  subject,
  size = "icon",
  log = true,
  logWhatsApp = true,
  whatsappText,
  whenMissing = "hide",
  showNumber = false,
  prominentCall = false,
  className,
  onLogged,
}: {
  phone?: string | null;
  whatsapp?: string | null;
  /** Where the logged call goes: { opportunityId } for a booking row / deal, { contactId } for a person. */
  target: ActivityTarget;
  /** Owner's timezone (env.timezone). */
  timezone: string;
  /** Shown in the dialog: "María López · Teatro Jovellanos". */
  subject?: string | null;
  size?: PhoneActionSize;
  /** Open the log dialog after Call (default true). */
  log?: boolean;
  /** …and after WhatsApp (default true). */
  logWhatsApp?: boolean;
  whatsappText?: string;
  /** "disabled": show both buttons dimmed when a number is missing (keeps a tile grid aligned). */
  whenMissing?: "hide" | "disabled";
  /** "button" size: the Call button shows the number. */
  showNumber?: boolean;
  /** Call as a labelled primary button (the next step is a call); WhatsApp keeps `size`. */
  prominentCall?: boolean;
  /** Wrapper classes (ignored for tiles: they sit directly in the parent's grid / flex row). */
  className?: string;
  onLogged?: (result: LoggedActivity) => void;
}) {
  const logger = useActivityLogger({ timezone, onLogged: onLogged ? (result) => onLogged(result) : undefined });
  const contact = { phone, whatsapp };
  const canCall = Boolean(telHref(phone));
  const canWhatsApp = Boolean(whatsappUrl(contact));
  if (!canCall && !canWhatsApp && whenMissing === "hide") return null;

  const call = (
    <CallButton
      phone={phone}
      size={size}
      showNumber={showNumber}
      whenMissing={whenMissing}
      prominent={prominentCall}
      onCall={log ? () => logger.open({ target, kind: "call", subject, phone }) : undefined}
    />
  );
  const wa = (
    <WhatsAppButton
      contact={contact}
      size={size}
      text={whatsappText}
      whenMissing={whenMissing}
      onOpen={log && logWhatsApp ? () => logger.open({ target, kind: "whatsapp", subject, phone }) : undefined}
    />
  );

  if (size === "tile") {
    return (
      <>
        {call}
        {wa}
        {logger.dialog}
      </>
    );
  }
  return (
    <span className={cn("inline-flex items-center", size === "button" ? "flex-wrap gap-2" : prominentCall && canCall ? "gap-1" : "gap-0.5", className)}>
      {call}
      {wa}
      {logger.dialog}
    </span>
  );
}
