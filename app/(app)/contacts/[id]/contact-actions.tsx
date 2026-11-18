"use client";

import Link from "next/link";
import { Mail, MessageCircle, NotebookPen, Phone } from "lucide-react";
import { menuItemClass } from "../../_components/ui";
import { CallButton, WhatsAppButton } from "@/components/booking/phone-actions";
import { phoneActionClass } from "@/components/booking/phone-action-class";
import { useActivityLogger } from "@/components/booking/log-activity-dialog";
import { Button, ButtonLink } from "@/components/ui/button";
import { telHref, whatsappUrl } from "@/lib/booking/phone";

/**
 * The contact header's actions. Phones: a row of iOS contact-card tiles
 * (Call, WhatsApp, Email, Log); desktop: Call (with the number), WhatsApp
 * and "Log call / note". Tapping Call or WhatsApp opens the log dialog right
 * after, so it is waiting when the owner comes back. Without a phone number
 * Call becomes "Add phone" (the profile form).
 */
export function ContactActions({
  contactId,
  phone,
  whatsapp,
  email,
  subject,
  timezone,
  addPhoneHref,
  variant = "default",
}: {
  contactId: string;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  /** Shown in the log dialog: "María López · Teatro Jovellanos". */
  subject: string;
  timezone: string;
  /** The profile form, focused on the phone field. */
  addPhoneHref: string;
  /** "menu": items for the phone header's ⋯ menu (the tiles and desktop buttons are not drawn). */
  variant?: "default" | "menu";
}) {
  const logger = useActivityLogger({ timezone });
  const target = { contactId };
  const contact = { phone, whatsapp };
  const canCall = Boolean(telHref(phone));
  const hasWhatsApp = Boolean(whatsappUrl(contact));
  const logCall = () => logger.open({ target, kind: "call", subject, phone });
  const logWhatsApp = () => logger.open({ target, kind: "whatsapp", subject, phone });
  const logAny = () => logger.open({ target, kind: canCall ? "call" : "note", subject, phone });

  if (variant === "menu") {
    const wa = whatsappUrl(contact);
    const tel = telHref(phone);
    return (
      <>
        {tel ? (
          <a href={tel} onClick={() => setTimeout(logCall, 400)} className={menuItemClass}>
            <Phone className="size-4 text-muted" strokeWidth={1.75} aria-hidden /> Call
          </a>
        ) : (
          <Link href={addPhoneHref} className={menuItemClass}>
            <Phone className="size-4 text-muted" strokeWidth={1.75} aria-hidden /> Add phone
          </Link>
        )}
        {wa ? (
          <a href={wa} target="_blank" rel="noreferrer" onClick={() => setTimeout(logWhatsApp, 400)} className={menuItemClass}>
            <MessageCircle className="size-4 text-muted" strokeWidth={1.75} aria-hidden /> WhatsApp
          </a>
        ) : null}
        {email ? (
          <a href={`mailto:${email}`} className={menuItemClass}>
            <Mail className="size-4 text-muted" strokeWidth={1.75} aria-hidden /> Email
          </a>
        ) : null}
        <button type="button" onClick={logAny} className={menuItemClass}>
          <NotebookPen className="size-4 text-muted" strokeWidth={1.75} aria-hidden /> Log call / note
        </button>
        {logger.dialog}
      </>
    );
  }

  return (
    <>
      <div className="flex w-full gap-2 md:hidden">
        {canCall ? (
          <CallButton phone={phone} size="tile" onCall={logCall} />
        ) : (
          <Link href={addPhoneHref} className={phoneActionClass("tile")}>
            <Phone className="size-5" strokeWidth={1.75} aria-hidden />
            <span className="max-w-full truncate">Add phone</span>
          </Link>
        )}
        {hasWhatsApp ? <WhatsAppButton contact={contact} size="tile" onOpen={logWhatsApp} /> : null}
        {email ? (
          <a href={`mailto:${email}`} className={phoneActionClass("tile")}>
            <Mail className="size-5" strokeWidth={1.75} aria-hidden />
            <span className="max-w-full truncate">Email</span>
          </a>
        ) : null}
        <button type="button" onClick={logAny} className={phoneActionClass("tile")}>
          <NotebookPen className="size-5" strokeWidth={1.75} aria-hidden />
          <span className="max-w-full truncate">Log</span>
        </button>
      </div>

      <div className="hidden md:flex md:flex-wrap md:items-center md:gap-2">
        {canCall ? (
          <CallButton phone={phone} size="button" showNumber onCall={logCall} />
        ) : (
          <ButtonLink href={addPhoneHref} variant="ghost">
            <Phone className="size-4" strokeWidth={1.75} aria-hidden />
            Add phone
          </ButtonLink>
        )}
        {hasWhatsApp ? <WhatsAppButton contact={contact} size="button" onOpen={logWhatsApp} /> : null}
        <Button onClick={logAny}>
          <NotebookPen className="size-4" strokeWidth={1.75} aria-hidden />
          Log call / note
        </Button>
      </div>

      {logger.dialog}
    </>
  );
}
