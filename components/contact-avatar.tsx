"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { safePhotoUrl } from "@/lib/contacts/photo";
import { cn, initials } from "@/lib/utils";

/**
 * A person's avatar: their photo (contacts.photo_url) when there is one,
 * else — and whenever the photo fails to load — the initials circle used
 * everywhere in the app. The photo sits over the initials, so they show
 * while it loads too. Remote images load lazily without a referrer.
 */

const SIZES = {
  /** 24px: chips, compact lines. */
  xs: "size-6 text-[10px]",
  /** 32px: list rows (the classic Avatar). */
  sm: "size-8 text-xs",
  /** 40px: cards and phone rows. */
  md: "size-10 text-sm",
  /** Contact page header: 80px on phones, 48px on desktop. */
  lg: "size-20 text-2xl md:size-12 md:text-base",
} as const;

export type ContactAvatarSize = keyof typeof SIZES;

export interface AvatarContact {
  displayName: string;
  photoUrl?: string | null;
}

export function ContactAvatar({
  contact,
  size = "sm",
  className,
  zoomable = false,
  photoSource,
}: {
  contact: AvatarContact;
  size?: ContactAvatarSize;
  className?: string;
  /** Tap the photo to see it full screen (only when there is a photo). */
  zoomable?: boolean;
  /** Page the photo was found on, linked in the full-screen view. */
  photoSource?: string | null;
}) {
  const url = safePhotoUrl(contact.photoUrl);
  const [failed, setFailed] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const showPhoto = url !== null && failed !== url;
  /** An image that failed before hydration never fires onError again: check on mount. */
  const check = (el: HTMLImageElement | null) => {
    if (el && url && el.complete && el.naturalWidth === 0) setFailed(url);
  };

  const avatar = (
    <span
      aria-hidden
      data-avatar={showPhoto ? "photo" : "initials"}
      className={cn(
        "relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full bg-surface-2 font-medium text-muted",
        SIZES[size],
        !(zoomable && showPhoto) && className,
      )}
    >
      {initials(contact.displayName)}
      {showPhoto ? (
        // eslint-disable-next-line @next/next/no-img-element -- remote photos of any host; next/image would need every domain configured
        <img
          ref={check}
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(url)}
          className="absolute inset-0 size-full rounded-full bg-surface-2 object-cover"
        />
      ) : null}
    </span>
  );

  if (!zoomable || !showPhoto || !url) return avatar;
  return (
    <>
      <button
        type="button"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen(true);
        }}
        aria-label={`See ${contact.displayName}'s photo`}
        className={cn("relative z-10 inline-flex shrink-0 cursor-zoom-in rounded-full active:opacity-80", className)}
      >
        {avatar}
      </button>
      {open ? <PhotoViewer url={url} name={contact.displayName} source={photoSource ?? null} onClose={close} /> : null}
    </>
  );
}

/** Full-screen photo: tap anywhere, ✕ or Escape closes it. */
function PhotoViewer({ url, name, source, onClose }: { url: string; name: string; source: string | null; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.documentElement.style.overflow = previous;
      document.removeEventListener("keydown", onKey);
      opener?.focus?.({ preventScroll: true });
    };
  }, [onClose]);

  let host: string | null = null;
  try {
    host = source ? new URL(source).hostname.replace(/^www\./, "") : null;
  } catch {
    host = null;
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${name}'s photo`}
      onClick={onClose}
      className="fixed inset-0 z-[90] flex cursor-zoom-out flex-col items-center justify-center gap-4 bg-black/90 px-4 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] pt-[calc(env(safe-area-inset-top)+3.5rem)] backdrop-blur-sm transition-opacity duration-150 starting:opacity-0"
    >
      <button
        ref={closeRef}
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute right-3 top-[calc(env(safe-area-inset-top)+0.5rem)] flex size-11 items-center justify-center rounded-full text-white/90 hover:bg-white/10"
      >
        <X className="size-6" />
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element -- same remote photo as the avatar */}
      <img
        src={url}
        alt={name}
        referrerPolicy="no-referrer"
        className="max-h-[78dvh] max-w-full rounded-xl object-contain shadow-2xl"
      />
      <div className="flex flex-col items-center gap-0.5 text-center" onClick={(event) => event.stopPropagation()}>
        <p className="text-[17px] font-semibold text-white">{name}</p>
        {source && host ? (
          <a href={source} target="_blank" rel="noopener noreferrer" className="text-[13px] text-white/70 underline-offset-2 hover:underline">
            Photo: {host}
          </a>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
