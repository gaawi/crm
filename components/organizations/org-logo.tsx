"use client";

import { useState } from "react";
import { Building2 } from "lucide-react";
import { safePhotoUrl } from "@/lib/contacts/photo";
import { cn, initials } from "@/lib/utils";

/**
 * An organization's logo (profile.logo, from its official site) in a
 * rounded square, on white so dark and transparent logos read in both
 * themes. Without a logo, or when it fails to load, its initials.
 * Same sizes as ContactAvatar so the two sit side by side.
 */

const SIZES = {
  md: "size-10 text-sm",
  lg: "size-20 text-2xl md:size-12 md:text-base",
} as const;

export function OrgLogo({
  name,
  logo,
  size = "md",
  className,
}: {
  name: string;
  logo?: string | null;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const url = safePhotoUrl(logo);
  const [failed, setFailed] = useState<string | null>(null);
  const showLogo = url !== null && failed !== url;
  /** A logo that failed before hydration never fires onError again: check on mount. */
  const check = (el: HTMLImageElement | null) => {
    if (el && url && el.complete && el.naturalWidth === 0) setFailed(url);
  };
  return (
    <span
      aria-hidden
      data-logo={showLogo ? "image" : "initials"}
      className={cn(
        "relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-xl border border-border font-semibold",
        showLogo ? "bg-white" : "bg-surface-2 text-muted",
        SIZES[size],
        className,
      )}
    >
      {showLogo ? (
        // eslint-disable-next-line @next/next/no-img-element -- remote logos of any host; next/image would need every domain configured
        <img
          ref={check}
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(url)}
          className="size-full object-contain p-1.5"
        />
      ) : initials(name) ? (
        initials(name)
      ) : (
        <Building2 className="size-1/2" />
      )}
    </span>
  );
}
