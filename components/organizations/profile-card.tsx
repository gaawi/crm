"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import {
  ArrowRight,
  Building2,
  CalendarDays,
  CircleHelp,
  Handshake,
  Link2,
  Phone,
  ChevronRight,
  ExternalLink,
  Info,
  Lightbulb,
  Mail,
  Music,
  Pencil,
  Sparkles,
  Tent,
  Theater,
  Users,
} from "lucide-react";
import { VenuePhoto } from "@/components/organizations/venue-photo";
import { PlaceLink } from "@/components/organizations/place-link";
import { Sheet } from "@/components/ui/sheet";
import {
  hostOf,
  isHttpsUrl,
  addressMapsUrl,
  orgPlace,
  PROFILE_KIND_LABEL,
  profileTagline,
  profileTaglineParts,
  venueMapsUrl,
  type BookingAnalysis,
  type FitLevel,
  type OrgProfile,
  type OrgProfileOwner,
  type PersonRelation,
  type RelationshipStatus,
  type ProfileKind,
} from "@/lib/organizations/profile";
import { OrgLogo } from "@/components/organizations/org-logo";
import { cn } from "@/lib/utils";

/**
 * An organization's profile at a glance: photos (the first large, the rest
 * in a strip you can scroll and tap), summary, chips (kind, place, dates,
 * scale), what they program, their venues, why ADAR fits and ideas, people,
 * links, and who researched it with the sources.
 *
 * `OrgProfileLine` is what lists show (Today, Approvals, booking sheet,
 * contact page): one line with a "Profile" button that opens this card in
 * a modal.
 *
 * Remote images: plain <img> without referrer, lazy, and hidden when they
 * fail to load (a dead link never leaves a broken icon behind).
 */

const KIND_ICON: Record<ProfileKind, typeof Building2> = {
  series: Music,
  festival: Tent,
  venue: Theater,
  presenter: Music,
  organization: Building2,
  other: Building2,
};

const chipClass =
  "inline-flex min-w-0 max-w-full items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1 text-[13px] leading-tight text-muted md:px-2 md:py-0.5 md:text-xs";

function Chip({ icon: Icon, children }: { icon?: typeof Building2; children: ReactNode }) {
  return (
    <span className={chipClass}>
      {Icon ? <Icon className="size-3.5 shrink-0 md:size-3" strokeWidth={1.75} aria-hidden /> : null}
      <span className="truncate">{children}</span>
    </span>
  );
}

function researchedLine(p: OrgProfile): string {
  const who =
    p.researchedBy === "owner"
      ? "Edited by you"
      : !p.researchedBy || p.researchedBy === "claude"
        ? "Researched by Claude"
        : `Researched by ${p.researchedBy}`;
  if (!p.researchedAt) return who;
  const at = new Date(p.researchedAt);
  if (Number.isNaN(at.getTime())) return who;
  return `${who} · ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(at)}`;
}

function capacityLabel(capacity: number | null | undefined): string | null {
  return capacity != null ? `${capacity.toLocaleString("en-US")} ${capacity === 1 ? "seat" : "seats"}` : null;
}

/** Images that are left once the ones that failed are dropped. */
function useImages(profile: OrgProfile) {
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  const images = (profile.images ?? []).filter((img) => isHttpsUrl(img.url) && !failed.has(img.url));
  const fail = (url: string) => setFailed((prev) => (prev.has(url) ? prev : new Set(prev).add(url)));
  /** An image that already failed before hydration never fires onError again: check on mount. */
  const check = (url: string) => (el: HTMLImageElement | null) => {
    if (el && el.complete && el.naturalWidth === 0) fail(url);
  };
  return { images, fail, check };
}

function RemoteImage({
  url,
  alt,
  className,
  onFail,
  check,
  eager = false,
}: {
  url: string;
  alt: string;
  className?: string;
  onFail: () => void;
  check: (el: HTMLImageElement | null) => void;
  eager?: boolean;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- remote images of any host; next/image would need every domain configured
    <img
      ref={check}
      src={url}
      alt={alt}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      referrerPolicy="no-referrer"
      onError={onFail}
      className={cn("object-cover", className)}
    />
  );
}

function Section({ title, icon: Icon, children }: { title: string; icon?: typeof Building2; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h4 className="flex items-center gap-1.5 text-[13px] font-semibold uppercase tracking-wide text-subtle md:text-[11px]">
        {Icon ? <Icon className="size-3.5" strokeWidth={2} aria-hidden /> : null}
        {title}
      </h4>
      {children}
    </section>
  );
}

const FIT_LABEL: Record<FitLevel, string> = { high: "High fit", medium: "Medium fit", low: "Low fit" };
const FIT_CLASS: Record<FitLevel, string> = {
  high: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  medium: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  low: "bg-surface-2 text-muted",
};
const STATUS_LABEL: Record<RelationshipStatus, string> = {
  none: "Not contacted yet",
  contacted: "Contacted, no answer",
  replied: "They replied",
  interested: "Interested",
  in_conversation: "In conversation",
  declined: "Declined",
  booked: "Booked",
};
const RELATION_LABEL: Record<PersonRelation, string> = {
  decision: "Books the artists",
  programming: "Programming",
  talked: "We've written",
  primary: "Main contact",
  admin: "Administration",
  other: "",
};
const SIGNAL_LABEL: [keyof NonNullable<BookingAnalysis["signals"]>, string][] = [
  ["chamberMusic", "Chamber music"],
  ["international", "International ensembles"],
  ["contemporary", "Contemporary music"],
  ["multidisciplinary", "Multidisciplinary"],
  ["visual", "Visuals"],
];

function shortDate(iso: string | undefined): string | null {
  if (!iso) return null;
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** Booking at a glance: fit, where the relationship stands, the next step, whom to pitch and what to offer. */
function BookingBlock({ booking: b }: { booking: BookingAnalysis }) {
  const rel = b.relationship;
  const signals = SIGNAL_LABEL.filter(([key]) => b.signals?.[key] && b.signals[key] !== "unknown");
  return (
    <div data-testid="org-booking" className="flex flex-col gap-3 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="flex items-center gap-1.5 text-[13px] font-semibold uppercase tracking-wide text-muted md:text-[11px]">
          <Handshake className="size-3.5" strokeWidth={2} aria-hidden />
          Booking{b.brand ? ` · ${b.brand}` : ""}
        </h4>
        {b.fit ? <span className={cn("rounded-full px-2 py-0.5 text-[12px] font-semibold md:text-[11px]", FIT_CLASS[b.fit])}>{FIT_LABEL[b.fit]}</span> : null}
        {rel?.status ? <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[12px] text-fg md:text-[11px]">{STATUS_LABEL[rel.status]}</span> : null}
        {rel?.waitingOn === "them" ? <span className="text-[12px] text-subtle md:text-[11px]">waiting for their answer</span> : null}
        {rel?.waitingOn === "us" ? <span className="text-[12px] font-medium text-amber-700 dark:text-amber-300 md:text-[11px]">they wait for us</span> : null}
      </div>

      {b.nextStep ? (
        <p className="flex items-start gap-2 rounded-md bg-brand/10 px-3 py-2 text-[15px] font-medium text-fg md:text-sm">
          <ArrowRight className="mt-0.5 size-4 shrink-0 text-brand" strokeWidth={2} aria-hidden />
          <span>{b.nextStep}</span>
        </p>
      ) : null}

      {rel && (rel.summary || rel.lastSent || rel.lastReceived) ? (
        <div className="flex flex-col gap-1">
          <p className="text-[13px] text-muted md:text-xs">
            {[rel.lastSent ? `We wrote ${shortDate(rel.lastSent)}` : null, rel.lastReceived ? `they wrote ${shortDate(rel.lastReceived)}` : null]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {rel.summary ? <p className="prose-plain text-[15px] leading-relaxed text-fg md:text-sm">{rel.summary}</p> : null}
          {rel.commitments?.length ? (
            <ul className="flex list-disc flex-col gap-0.5 pl-5 text-[15px] text-fg marker:text-subtle md:text-sm">
              {rel.commitments.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {b.fitReasons ? <p className="prose-plain text-[15px] leading-relaxed text-fg md:text-sm">{b.fitReasons}</p> : null}
      {signals.length ? (
        <ul className="flex flex-wrap gap-1.5">
          {signals.map(([key, label]) => (
            <li
              key={key}
              className={cn(
                "rounded-full px-2 py-0.5 text-[12px] md:text-[11px]",
                b.signals?.[key] === "yes" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-surface-2 text-subtle line-through",
              )}
            >
              {label}
            </li>
          ))}
        </ul>
      ) : null}

      {b.program || b.pitchTo ? (
        <dl className="grid gap-2 text-[15px] md:grid-cols-[7rem_minmax(0,1fr)] md:text-sm">
          {b.program ? (
            <>
              <dt className="text-muted">What to offer</dt>
              <dd className="prose-plain text-fg">{b.program}</dd>
            </>
          ) : null}
          {b.pitchTo ? (
            <>
              <dt className="text-muted">Pitch to</dt>
              <dd className="text-fg">
                <span className="font-medium">{b.pitchTo.name}</span>
                {b.pitchTo.role ? <span className="text-muted"> · {b.pitchTo.role}</span> : null}
                {b.pitchTo.email ? (
                  <a href={`mailto:${b.pitchTo.email}`} className="ml-1 text-muted hover:text-fg hover:underline">
                    {b.pitchTo.email}
                  </a>
                ) : null}
                {b.pitchTo.why ? <span className="block text-[13px] text-muted md:text-xs">{b.pitchTo.why}</span> : null}
              </dd>
            </>
          ) : null}
          {b.season ? (
            <>
              <dt className="text-muted">Season</dt>
              <dd className="prose-plain text-fg">{b.season}</dd>
            </>
          ) : null}
          {b.similarArtists?.length ? (
            <>
              <dt className="text-muted">Similar artists</dt>
              <dd className="text-fg">{b.similarArtists.join(", ")}</dd>
            </>
          ) : null}
        </dl>
      ) : null}

      {b.emailHooks?.length ? (
        <div className="flex flex-col gap-1">
          <p className="text-[13px] text-muted md:text-xs">For a personal email</p>
          <ul className="flex list-disc flex-col gap-0.5 pl-5 text-[15px] text-fg marker:text-subtle md:text-sm">
            {b.emailHooks.map((h, i) => (
              <li key={i}>{h}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {b.pending?.length ? (
        <div className="flex flex-col gap-1 rounded-md bg-surface-2 px-3 py-2">
          <p className="flex items-center gap-1.5 text-[13px] text-muted md:text-xs">
            <CircleHelp className="size-3.5" strokeWidth={2} aria-hidden />
            To verify
          </p>
          <ul className="flex list-disc flex-col gap-0.5 pl-5 text-[13px] text-muted marker:text-subtle md:text-xs">
            {b.pending.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {b.verifiedAt ? <p className="text-[12px] text-subtle md:text-[11px]">Checked {shortDate(b.verifiedAt)}</p> : null}
    </div>
  );
}

/** The full card in a modal: a centered dialog on desktop, a full-screen sheet on phones. */
export function OrgProfileDialog({
  open,
  onClose,
  profile,
  organization,
  editHref,
}: {
  open: boolean;
  onClose: () => void;
  profile: OrgProfile;
  organization?: OrgProfileOwner | null;
  editHref?: string | null;
}) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={organization?.name ?? "Profile"}
      description={profileTagline(profile, organization)}
      className="md:w-[min(40rem,calc(100vw-2rem))]"
    >
      <OrgProfileCard
        profile={profile}
        organization={organization}
        showName={false}
        editHref={editHref}
        orgHref={organization?.id ? `/organizations/${organization.id}` : null}
        bare
      />
    </Sheet>
  );
}

/** A small info icon that opens the profile popup (next to a venue's name in the booking sheet). */
export function OrgProfileIconButton({
  profile,
  organization,
  editHref,
  className,
}: {
  profile: OrgProfile;
  organization?: OrgProfileOwner | null;
  editHref?: string | null;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={organization?.name ? `Profile of ${organization.name}` : "Profile"}
        title="Profile"
        data-testid="org-profile-icon"
        className={cn(
          "inline-flex size-11 shrink-0 items-center justify-center rounded-full text-subtle active:bg-surface-2 md:size-6 md:rounded-md md:hover:bg-surface-2 md:hover:text-fg",
          className,
        )}
      >
        <Info className="size-5 md:size-3.5" strokeWidth={1.75} aria-hidden />
      </button>
      <OrgProfileDialog open={open} onClose={() => setOpen(false)} profile={profile} organization={organization} editHref={editHref} />
    </>
  );
}

/**
 * The profile in one line: a small round photo, what they are and where
 * (a Google Maps link), and a "Profile" button. The photo, the text and the
 * button all open the full card in a popup; the card is never inline.
 */
export function OrgProfileLine({
  profile,
  organization,
  editHref,
  buttonLabel = "Profile",
  labelOnPhone = false,
  thumb = true,
  showPlace = true,
  className,
}: {
  profile: OrgProfile;
  organization?: OrgProfileOwner | null;
  /** The popup's "Edit" link. */
  editHref?: string | null;
  /** The button's label on desktop (phones show the icon only). */
  buttonLabel?: string;
  /** Show the label on phones too (a 44pt pill instead of the icon alone). */
  labelOnPhone?: boolean;
  thumb?: boolean;
  /** false: the place is shown elsewhere on the page (the org page header). */
  showPlace?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const { images, fail, check } = useImages(profile);
  const photo = thumb ? images[0] : undefined;
  const { lead, place } = profileTaglineParts(profile, organization);
  const name = organization?.name;
  const show = () => setOpen(true);

  return (
    <div data-testid="org-profile-line" className={cn("flex min-w-0 items-center gap-2", className)}>
      {photo ? (
        <button type="button" tabIndex={-1} aria-hidden onClick={show} className="shrink-0 rounded-full">
          <RemoteImage
            key={photo.url}
            url={photo.url}
            alt=""
            onFail={() => fail(photo.url)}
            check={check(photo.url)}
            className="size-7 rounded-full bg-surface-2"
          />
        </button>
      ) : null}
      <span className="flex min-w-0 flex-1 items-center gap-1.5 text-[15px] text-muted md:text-sm">
        <button
          type="button"
          onClick={show}
          tabIndex={-1}
          title={place && showPlace ? `${lead} · ${place.label}` : lead}
          className="min-w-0 shrink truncate text-left hover:text-fg"
        >
          {lead}
        </button>
        {place && showPlace ? (
          <>
            <span aria-hidden className="shrink-0 text-subtle">
              ·
            </span>
            <PlaceLink place={place} className="max-w-[60%] shrink-0 text-[13px] md:text-sm" />
          </>
        ) : null}
      </span>
      <button
        type="button"
        onClick={show}
        aria-haspopup="dialog"
        aria-label={name ? `${buttonLabel} of ${name}` : buttonLabel}
        data-testid="org-profile-open"
        className={cn(
          "-my-2 inline-flex shrink-0 items-center justify-center rounded-full active:bg-surface-2 md:my-0 md:h-7 md:gap-1 md:border md:border-border md:px-2.5 md:text-xs md:hover:bg-surface-2 md:hover:text-fg",
          labelOnPhone
            ? "h-11 gap-1.5 border border-border px-3.5 text-[15px] font-medium text-fg md:font-normal md:text-muted"
            : "size-11 text-muted md:size-auto",
        )}
      >
        <Info className={cn("md:size-3.5", labelOnPhone ? "size-4" : "size-5")} strokeWidth={1.75} aria-hidden />
        <span className={labelOnPhone ? undefined : "hidden md:inline"}>{buttonLabel}</span>
      </button>
      <OrgProfileDialog open={open} onClose={() => setOpen(false)} profile={profile} organization={organization} editHref={editHref} />
    </div>
  );
}

/** The full card (shown in the popup). `bare`: no border, edge to edge. */
export function OrgProfileCard({
  profile: p,
  organization,
  editHref,
  orgHref,
  showName = true,
  hideAtAGlance = false,
  bare = false,
  className,
}: {
  profile: OrgProfile;
  organization?: OrgProfileOwner | null;
  /** An "Edit" link in the footer. */
  editHref?: string | null;
  /** An "Open organization" link in the footer. */
  orgHref?: string | null;
  /** The organization's name above the summary. */
  showName?: boolean;
  /** Leave out the groups they present, who has played and the venues (the flashcard shows them at the top). */
  hideAtAGlance?: boolean;
  bare?: boolean;
  className?: string;
}) {
  const { images, fail, check } = useImages(p);
  const [selected, setSelected] = useState(0);
  const heroIndex = selected < images.length ? selected : 0;
  const hero = images[heroIndex];
  const KindIcon = KIND_ICON[p.kind ?? "organization"];
  const sources = (p.sources ?? []).filter(isHttpsUrl);
  const links = (p.links ?? []).filter((l) => isHttpsUrl(l.url));
  const name = organization?.name;
  const place = orgPlace(organization, p);
  const addressUrl = addressMapsUrl(p, organization);

  return (
    <article
      data-testid="org-profile"
      className={cn("overflow-hidden bg-surface", bare ? "-mx-4 -mt-4 md:-mx-5" : "rounded-xl border border-border md:rounded-lg", className)}
    >
      {hero ? (
        <div>
          <figure className="relative aspect-[16/9] max-h-[180px] w-full bg-surface-2 md:aspect-[2/1] md:max-h-[220px]">
            <RemoteImage
              key={hero.url}
              url={hero.url}
              alt={hero.caption ?? (name ? `${name}` : "Photo")}
              onFail={() => fail(hero.url)}
              check={check(hero.url)}
              eager
              className="absolute inset-0 size-full"
            />
            {hero.caption || hero.source ? (
              <figcaption className="absolute inset-x-0 bottom-0 flex items-end gap-2 bg-gradient-to-t from-black/60 to-transparent px-4 pb-2 pt-6 text-[13px] text-white md:text-xs">
                <span className="min-w-0 flex-1 truncate">{hero.caption}</span>
                {hero.source ? (
                  <span className="shrink-0 truncate text-white/75">
                    {isHttpsUrl(hero.source) ? (
                      <a href={hero.source} target="_blank" rel="noreferrer noopener" className="hover:underline">
                        {hostOf(hero.source)}
                      </a>
                    ) : (
                      hero.source.slice(0, 40)
                    )}
                  </span>
                ) : null}
              </figcaption>
            ) : null}
          </figure>

          {images.length > 1 ? (
            <div
              className="flex snap-x gap-2 overflow-x-auto px-4 pt-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              role="list"
              aria-label="Photos"
            >
              {images.map((img, i) => (
                <button
                  key={img.url}
                  type="button"
                  role="listitem"
                  onClick={() => setSelected(i)}
                  aria-label={img.caption ? `Show photo: ${img.caption}` : `Show photo ${i + 1}`}
                  aria-current={i === heroIndex}
                  className={cn(
                    "relative h-16 w-24 shrink-0 snap-start overflow-hidden rounded-md bg-surface-2 md:h-14 md:w-20",
                    i === heroIndex ? "ring-2 ring-fg/70" : "opacity-80 active:opacity-60 md:hover:opacity-100",
                  )}
                >
                  <RemoteImage url={img.url} alt="" onFail={() => fail(img.url)} check={check(img.url)} className="size-full" />
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-col gap-4 p-4">
        <div className="flex flex-col gap-2">
          {showName && name ? (
            <div className="flex items-center gap-2">
              {p.logo ? (
                <OrgLogo name={name} logo={p.logo} className="size-9" />
              ) : !hero ? (
                <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-muted" aria-hidden>
                  <KindIcon className="size-5" strokeWidth={1.5} />
                </span>
              ) : null}
              <h3 className="min-w-0 flex-1 text-[17px] font-semibold leading-snug text-fg [overflow-wrap:anywhere] md:text-base">{name}</h3>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-1.5">
            {p.kind ? <Chip icon={KindIcon}>{PROFILE_KIND_LABEL[p.kind]}</Chip> : null}
            {place ? <PlaceLink place={place} className={cn(chipClass, "hover:bg-surface-2/70")} iconClassName="size-3.5 md:size-3" /> : null}
            {p.dates ? <Chip icon={CalendarDays}>{p.dates}</Chip> : null}
            {p.scale ? <Chip icon={Users}>{p.scale}</Chip> : null}
          </div>
          {p.address && addressUrl ? (
            <div className="flex min-w-0">
              <PlaceLink place={{ label: p.address, mapsUrl: addressUrl }} className="text-[15px] text-muted md:text-sm" />
            </div>
          ) : null}
          <p className="text-[15px] leading-relaxed text-fg md:text-sm">{p.summary}</p>
        </div>

        {p.booking ? <BookingBlock booking={p.booking} /> : null}

        {p.programming ? (
          <Section title="Programs">
            <p className="prose-plain text-[15px] leading-relaxed text-fg md:text-sm">{p.programming}</p>
          </Section>
        ) : null}

        {!hideAtAGlance && p.formats?.length ? (
          <Section title="Groups they present">
            <ul className="flex flex-wrap gap-1.5">
              {p.formats.map((f, i) => (
                <li key={i} className="rounded-full bg-surface-2 px-2.5 py-0.5 text-[13px] text-fg md:text-xs">
                  {f}
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        {!hideAtAGlance && p.artists?.length ? (
          <Section title="Who has played">
            <ul className="flex flex-col gap-1">
              {p.artists.map((a, i) => (
                <li key={i} className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-[15px] md:text-sm">
                  <span className="font-medium text-fg">{a.name}</span>
                  {a.formation ? <span className="text-muted">· {a.formation}</span> : null}
                  {a.date ? <span className="text-subtle">· {a.date}</span> : null}
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        {!hideAtAGlance && p.venues?.length ? (
          <Section title={p.venues.length === 1 ? "Venue" : "Venues"}>
            <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
              {p.venues.map((v, i) => (
                <li key={`${v.name}-${i}`} className="flex items-start gap-3 px-3 py-2">
                  <VenuePhoto name={v.name} photo={v.photo} source={v.photoSource} className="mt-0.5 aspect-[4/3] w-24 md:w-20" />
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0">
                      <PlaceLink
                        place={{ label: v.name, mapsUrl: venueMapsUrl(v, p, organization) ?? "" }}
                        className="text-[15px] font-medium text-fg md:text-sm"
                        iconClassName="size-3.5 text-subtle"
                      />
                    </span>
                    {v.type || v.notes || v.address ? (
                      <span className="block text-[13px] text-muted md:text-xs">{[v.type, v.address, v.notes].filter(Boolean).join(" · ")}</span>
                    ) : null}
                  </span>
                  {capacityLabel(v.capacity) ? (
                    <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[13px] tabular-nums text-muted md:text-xs">
                      {capacityLabel(v.capacity)}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        {p.audience ? (
          <Section title="Audience">
            <p className="text-[15px] leading-relaxed text-fg md:text-sm">{p.audience}</p>
          </Section>
        ) : null}

        {p.highlights?.length ? (
          <Section title="Highlights">
            <ul className="flex flex-wrap gap-1.5">
              {p.highlights.map((h, i) => (
                <li key={i} className="rounded-md border border-border px-2 py-0.5 text-[13px] text-fg md:text-xs">
                  {h}
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        {p.fitForAdar || p.ideas?.length ? (
          <div className="flex flex-col gap-2 rounded-lg bg-surface-2 p-3">
            <h4 className="flex items-center gap-1.5 text-[13px] font-semibold uppercase tracking-wide text-muted md:text-[11px]">
              <Lightbulb className="size-3.5" strokeWidth={2} aria-hidden />
              Why {p.booking?.brand ?? "ADAR"}
            </h4>
            {p.fitForAdar ? <p className="prose-plain text-[15px] leading-relaxed text-fg md:text-sm">{p.fitForAdar}</p> : null}
            {p.ideas?.length ? (
              <ul className="flex list-disc flex-col gap-1 pl-5 text-[15px] leading-snug text-fg marker:text-subtle md:text-sm">
                {p.ideas.map((idea, i) => (
                  <li key={i}>{idea}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        {p.contacts?.length ? (
          <Section title="People">
            <ul className="flex flex-col gap-2">
              {p.contacts.map((c, i) => (
                <li key={i} className="flex min-w-0 items-start gap-3">
                  {c.photo ? (
                    <RemoteImage url={c.photo} alt={c.name} onFail={() => fail(c.photo!)} check={check(c.photo)} className="size-10 shrink-0 rounded-full bg-surface-2" />
                  ) : (
                    <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-2 text-[13px] font-medium text-muted" aria-hidden>
                      {c.name
                        .split(/\s+/)
                        .map((w) => w[0])
                        .slice(0, 2)
                        .join("")}
                    </span>
                  )}
                  <span className="min-w-0 flex-1 text-[15px] md:text-sm">
                    <span className="flex flex-wrap items-baseline gap-x-1.5">
                      {c.profileUrl ? (
                        <a href={c.profileUrl} target="_blank" rel="noreferrer noopener" className="font-medium text-fg hover:underline">
                          {c.name}
                        </a>
                      ) : (
                        <span className="font-medium text-fg">{c.name}</span>
                      )}
                      {c.relation && RELATION_LABEL[c.relation] ? (
                        <span
                          className={cn(
                            "rounded-full px-1.5 py-px text-[11px]",
                            c.relation === "decision" ? "bg-brand/15 font-medium text-brand" : "bg-surface-2 text-muted",
                          )}
                        >
                          {RELATION_LABEL[c.relation]}
                        </span>
                      ) : null}
                    </span>
                    {c.role ? <span className="block text-muted">{c.role}</span> : null}
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[13px] text-muted md:text-xs">
                      {c.email ? (
                        <a href={`mailto:${c.email}`} className="inline-flex min-w-0 items-center gap-1 hover:text-fg">
                          <Mail className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
                          <span className="truncate">{c.email}</span>
                        </a>
                      ) : null}
                      {c.phone ? (
                        <a href={`tel:${c.phone.replace(/[^+\d]/g, "")}`} className="inline-flex items-center gap-1 hover:text-fg">
                          <Phone className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
                          {c.phone}
                        </a>
                      ) : null}
                      {c.linkedin ? (
                        <a href={c.linkedin} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 hover:text-fg">
                          <Link2 className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
                          LinkedIn
                        </a>
                      ) : null}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        {links.length ? (
          <div className="flex flex-wrap gap-2">
            {links.map((l) => (
              <a
                key={l.url}
                href={l.url}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex h-9 max-w-full items-center gap-1.5 rounded-full border border-border px-3 text-[13px] text-fg active:bg-surface-2 md:h-7 md:text-xs md:hover:bg-surface-2"
              >
                <span className="truncate">{l.label}</span>
                <ExternalLink className="size-3.5 shrink-0 text-subtle" strokeWidth={1.75} aria-hidden />
              </a>
            ))}
          </div>
        ) : null}

        <footer className="flex flex-col gap-1 border-t border-border pt-3 text-[12px] text-subtle md:text-[11px]">
          <div className="flex items-center gap-2">
            <Sparkles className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
            <span className="min-w-0 flex-1 truncate">{researchedLine(p)}</span>
            {orgHref ? (
              <Link href={orgHref} className="inline-flex min-h-8 items-center gap-1 text-muted hover:text-fg">
                <Building2 className="size-3" strokeWidth={1.75} aria-hidden />
                Organization
              </Link>
            ) : null}
            {editHref ? (
              <Link href={editHref} scroll={false} className="inline-flex min-h-8 items-center gap-1 text-muted hover:text-fg">
                <Pencil className="size-3" strokeWidth={1.75} aria-hidden />
                Edit
              </Link>
            ) : null}
          </div>
          {sources.length ? (
            <details className="group">
              <summary className="flex min-h-8 cursor-pointer list-none items-center gap-1 [&::-webkit-details-marker]:hidden">
                {sources.length} {sources.length === 1 ? "source" : "sources"}
                <ChevronRight className="size-3 transition-transform group-open:rotate-90" strokeWidth={2} aria-hidden />
              </summary>
              <ul className="flex flex-col gap-0.5 pb-1">
                {sources.map((s) => (
                  <li key={s} className="truncate">
                    <a href={s} target="_blank" rel="noreferrer noopener" className="hover:text-fg hover:underline">
                      {hostOf(s)}
                      <span className="text-subtle/70">{s.replace(/^https:\/\/[^/]+/, "").slice(0, 80)}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </footer>
      </div>
    </article>
  );
}
