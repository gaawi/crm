"use client";

import { useCallback, useState } from "react";
import { PhotoViewer } from "@/components/contact-avatar";
import { safePhotoUrl } from "@/lib/contacts/photo";
import { cn } from "@/lib/utils";

/**
 * A hall's photo (venues[].photo, from an official site): a thumbnail that
 * opens full screen. Nothing when there is none or it fails to load.
 */
export function VenuePhoto({ name, photo, source, className }: { name: string; photo?: string | null; source?: string | null; className?: string }) {
  const url = safePhotoUrl(photo);
  const [failed, setFailed] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  if (!url || failed === url) return null;
  /** A photo that failed before hydration never fires onError again: check on mount. */
  const check = (el: HTMLImageElement | null) => {
    if (el && el.complete && el.naturalWidth === 0) setFailed(url);
  };
  return (
    <>
      <button
        type="button"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen(true);
        }}
        aria-label={`See a photo of ${name}`}
        className={cn("block shrink-0 cursor-zoom-in overflow-hidden rounded-lg bg-surface active:opacity-80", className)}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- remote photos of any host; next/image would need every domain configured */}
        <img
          ref={check}
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(url)}
          className="size-full object-cover"
        />
      </button>
      {open ? <PhotoViewer url={url} name={name} source={source ?? null} onClose={close} /> : null}
    </>
  );
}
