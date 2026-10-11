"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Gmail-style avatar for the phone mail list: the contact's photo (served by
 * /api/contact-photo, since Mail loads no remote images) over a colored
 * circle with the sender's first letter. The color is stable per sender.
 */

const COLORS = [
  "bg-[#e8710a]",
  "bg-[#1a73e8]",
  "bg-[#188038]",
  "bg-[#d93025]",
  "bg-[#9334e6]",
  "bg-[#e52592]",
  "bg-[#12b5cb]",
  "bg-[#f9ab00]",
  "bg-[#5f6368]",
  "bg-[#a142f4]",
];

function colorFor(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length];
}

/** First letter of the name (or address), skipping quotes and symbols. */
export function avatarLetter(name: string): string {
  const match = /[\p{L}\p{N}]/u.exec(name);
  return match ? match[0].toUpperCase() : "?";
}

export function MailAvatar({ name, colorKey, photoSrc, className }: { name: string; colorKey?: string; photoSrc?: string | null; className?: string }) {
  const [failed, setFailed] = useState(false);
  const showPhoto = Boolean(photoSrc) && !failed;
  /** An image that failed before hydration never fires onError again: check on mount. */
  const check = (el: HTMLImageElement | null) => {
    if (el && el.complete && el.naturalWidth === 0) setFailed(true);
  };
  return (
    <span
      aria-hidden
      className={cn(
        "relative inline-flex size-11 shrink-0 select-none items-center justify-center overflow-hidden rounded-full text-[20px] font-medium text-white",
        colorFor((colorKey ?? name).toLowerCase()),
        className,
      )}
    >
      {avatarLetter(name)}
      {showPhoto ? (
        // eslint-disable-next-line @next/next/no-img-element -- same-origin proxy; next/image adds nothing here
        <img
          ref={check}
          src={photoSrc!}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className="absolute inset-0 size-full rounded-full bg-surface-2 object-cover"
        />
      ) : null}
    </span>
  );
}
