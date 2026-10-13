"use client";

import Link from "next/link";
import { ContactAvatar, type AvatarContact } from "@/components/contact-avatar";
import { OrgLogo } from "@/components/organizations/org-logo";

/**
 * A contact's photo with their organization's logo: side by side in
 * headers and cards (the logo opens the organization), or as a small
 * corner badge on list avatars (only when the organization has a logo,
 * so lists stay quiet otherwise).
 */

export interface AvatarOrganization {
  id: string;
  name: string;
  logo?: string | null;
}

export function ContactOrgAvatar({
  contact,
  organization,
  size = "md",
  layout = "side",
  zoomable = false,
  photoSource,
  className,
  logoClassName,
}: {
  contact: AvatarContact;
  organization?: AvatarOrganization | null;
  size?: "sm" | "md" | "lg";
  /** "side": logo next to the photo, linked to the organization. "badge": logo in the photo's corner. */
  layout?: "side" | "badge";
  zoomable?: boolean;
  photoSource?: string | null;
  className?: string;
  logoClassName?: string;
}) {
  const avatar = <ContactAvatar contact={contact} size={size} zoomable={zoomable} photoSource={photoSource} className={className} />;
  if (!organization) return avatar;

  if (layout === "badge") {
    if (!organization.logo) return avatar;
    return (
      <span className="relative inline-flex shrink-0">
        {avatar}
        <OrgLogo
          name={organization.name}
          logo={organization.logo}
          size="badge"
          className="pointer-events-none absolute -bottom-1 -right-1 z-10 ring-2 ring-surface"
        />
      </span>
    );
  }

  return (
    <span className="inline-flex shrink-0 items-center gap-1.5">
      {avatar}
      <Link
        href={`/organizations/${organization.id}`}
        aria-label={`Open ${organization.name}`}
        title={organization.name}
        className="relative z-10 shrink-0 rounded-xl active:opacity-80"
      >
        <OrgLogo name={organization.name} logo={organization.logo} size={size} className={logoClassName ?? className} />
      </Link>
    </span>
  );
}
