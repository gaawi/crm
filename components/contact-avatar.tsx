"use client";

import { useState } from "react";
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
}: {
  contact: AvatarContact;
  size?: ContactAvatarSize;
  className?: string;
}) {
  const url = safePhotoUrl(contact.photoUrl);
  const [failed, setFailed] = useState<string | null>(null);
  const showPhoto = url !== null && failed !== url;
  /** An image that failed before hydration never fires onError again: check on mount. */
  const check = (el: HTMLImageElement | null) => {
    if (el && url && el.complete && el.naturalWidth === 0) setFailed(url);
  };

  return (
    <span
      aria-hidden
      data-avatar={showPhoto ? "photo" : "initials"}
      className={cn(
        "relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full bg-surface-2 font-medium text-muted",
        SIZES[size],
        className,
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
}
