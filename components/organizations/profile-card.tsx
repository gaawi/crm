"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import {
  Building2,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Lightbulb,
  Mail,
  MapPin,
  Music,
  Pencil,
  Sparkles,
  Tent,
  Theater,
  Users,
} from "lucide-react";
import { hostOf, isHttpsUrl, PROFILE_KIND_LABEL, type OrgProfile, type OrgProfileOwner, type ProfileKind } from "@/lib/organizations/profile";
import { cn } from "@/lib/utils";

/**
 * An organization's profile at a glance: photos (the first large, the rest
 * in a strip you can scroll and tap), summary, chips (kind, place, dates,
 * scale), what they program, their venues, why ADAR fits and ideas, people,
 * links, and who researched it with the sources.
 *
 * `compact`: thumbnail + name + summary + two chips, for lists; with
 * `expandable` a "More" toggle opens the full card in place, otherwise
 * `onSelect` or `href` (if any) make the whole card tappable.
 *
 * Remote images: plain <img> without referrer, lazy, and hidden when they
 * fail to load (a dead link never leaves a broken icon behind).
 */

const KIND_ICON: Record<ProfileKind, typeof Building2> = {
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
  const who = p.researchedBy === "owner" ? "Edited by you" : "Researched by Claude";
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

export function OrgProfileCard({
  profile,
  organization,
  compact = false,
  expandable = false,
  href,
  onSelect,
  plain = false,
  editHref,
  showName = true,
  wide = false,
  className,
}: {
  profile: OrgProfile;
  organization?: OrgProfileOwner | null;
  compact?: boolean;
  /** Full card on a wide page: photos left, text right from md up. */
  wide?: boolean;
  /** Compact only: a "More" toggle that opens the full card in place. */
  expandable?: boolean;
  /** Compact only: link to the organization (when not expandable). */
  href?: string | null;
  /** Compact only: the whole card is a button (e.g. open the row's history). */
  onSelect?: () => void;
  /** Compact only: no border or padding, to sit inside another card. */
  plain?: boolean;
  /** Full card: an "Edit" link in the footer. */
  editHref?: string | null;
  /** Full card: the organization's name above the summary. */
  showName?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  if (compact && !open) {
    return (
      <CompactCard
        profile={profile}
        organization={organization}
        href={expandable ? null : href}
        onExpand={expandable ? () => setOpen(true) : onSelect}
        expands={expandable}
        plain={plain}
        className={className}
      />
    );
  }
  return (
    <FullCard
      profile={profile}
      organization={organization}
      editHref={editHref}
      showName={showName}
      wide={wide && !compact}
      onCollapse={compact ? () => setOpen(false) : undefined}
      className={className}
    />
  );
}

function CompactCard({
  profile,
  organization,
  href,
  onExpand,
  expands,
  plain,
  className,
}: {
  profile: OrgProfile;
  organization?: OrgProfileOwner | null;
  href?: string | null;
  onExpand?: () => void;
  /** onExpand opens the full card in place (else it is a plain action). */
  expands: boolean;
  plain: boolean;
  className?: string;
}) {
  const { images, fail, check } = useImages(profile);
  const thumb = images[0];
  const KindIcon = KIND_ICON[profile.kind ?? "organization"];
  const chips = [
    profile.kind ? <Chip key="kind">{PROFILE_KIND_LABEL[profile.kind]}</Chip> : null,
    profile.location ? (
      <Chip key="loc" icon={MapPin}>
        {profile.location}
      </Chip>
    ) : null,
    profile.dates ? (
      <Chip key="dates" icon={CalendarDays}>
        {profile.dates}
      </Chip>
    ) : null,
  ]
    .filter(Boolean)
    .slice(0, 2);

  const body = (
    <>
      <span className="relative size-14 shrink-0 overflow-hidden rounded-lg bg-surface-2 md:size-12">
        <span className="absolute inset-0 flex items-center justify-center text-subtle" aria-hidden>
          <KindIcon className="size-6 md:size-5" strokeWidth={1.5} />
        </span>
        {thumb ? (
          <RemoteImage key={thumb.url} url={thumb.url} alt="" onFail={() => fail(thumb.url)} check={check(thumb.url)} className="relative size-full" />
        ) : null}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        {organization?.name ? <span className="truncate text-[15px] font-semibold text-fg md:text-sm">{organization.name}</span> : null}
        <span className="line-clamp-2 text-[13px] leading-snug text-muted md:text-xs">{profile.summary}</span>
        {chips.length ? <span className="flex min-w-0 flex-wrap gap-1">{chips}</span> : null}
      </span>
    </>
  );

  const shell = plain
    ? "flex w-full items-start gap-3 rounded-lg text-left"
    : "flex w-full items-start gap-3 rounded-xl border border-border bg-surface p-3 text-left md:rounded-lg md:p-2.5";
  if (onExpand) {
    return (
      <button
        type="button"
        onClick={onExpand}
        aria-expanded={expands ? false : undefined}
        data-testid="org-profile-compact"
        className={cn(shell, "active:bg-surface-2 md:hover:bg-surface-2/60", className)}
      >
        {body}
        {expands ? (
          <span className="flex shrink-0 items-center gap-0.5 self-center text-[13px] text-muted md:text-xs">
            <span className="sr-only md:not-sr-only">More</span>
            <ChevronDown className="size-5 md:size-4" strokeWidth={2} aria-hidden />
          </span>
        ) : (
          <ChevronRight className="size-4 shrink-0 self-center text-subtle" strokeWidth={2} aria-hidden />
        )}
      </button>
    );
  }
  if (href) {
    return (
      <Link href={href} data-testid="org-profile-compact" className={cn(shell, "active:bg-surface-2 md:hover:bg-surface-2/60", className)}>
        {body}
        <ChevronRight className="size-4 shrink-0 self-center text-subtle" strokeWidth={2} aria-hidden />
      </Link>
    );
  }
  return (
    <div data-testid="org-profile-compact" className={cn(shell, className)}>
      {body}
    </div>
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

function FullCard({
  profile: p,
  organization,
  editHref,
  showName,
  wide,
  onCollapse,
  className,
}: {
  profile: OrgProfile;
  organization?: OrgProfileOwner | null;
  editHref?: string | null;
  showName: boolean;
  wide: boolean;
  onCollapse?: () => void;
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

  return (
    <article
      data-testid="org-profile"
      className={cn(
        "overflow-hidden rounded-xl border border-border bg-surface md:rounded-lg",
        wide && hero && "md:grid md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:items-start",
        className,
      )}
    >
      {hero ? (
        <div className={cn(wide && "md:sticky md:top-0 md:pb-4")}>
          <figure className={cn("relative aspect-[16/9] w-full bg-surface-2", wide ? "md:aspect-[4/3]" : "md:aspect-[2/1]")}>
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
            <div className="flex snap-x gap-2 overflow-x-auto px-4 pt-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="list" aria-label="Photos">
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
              {!hero ? (
                <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-muted" aria-hidden>
                  <KindIcon className="size-5" strokeWidth={1.5} />
                </span>
              ) : null}
              <h3 className="min-w-0 flex-1 text-[17px] font-semibold leading-snug text-fg [overflow-wrap:anywhere] md:text-base">{name}</h3>
              {onCollapse ? <CollapseButton onClick={onCollapse} /> : null}
            </div>
          ) : onCollapse ? (
            <div className="flex justify-end">
              <CollapseButton onClick={onCollapse} />
            </div>
          ) : null}
          <div className="flex flex-wrap gap-1.5">
            {p.kind ? <Chip icon={KindIcon}>{PROFILE_KIND_LABEL[p.kind]}</Chip> : null}
            {p.location ? <Chip icon={MapPin}>{p.location}</Chip> : null}
            {p.dates ? <Chip icon={CalendarDays}>{p.dates}</Chip> : null}
            {p.scale ? <Chip icon={Users}>{p.scale}</Chip> : null}
          </div>
          <p className="text-[15px] leading-relaxed text-fg md:text-sm">{p.summary}</p>
        </div>

        {p.programming ? (
          <Section title="Programs">
            <p className="prose-plain text-[15px] leading-relaxed text-fg md:text-sm">{p.programming}</p>
          </Section>
        ) : null}

        {p.venues?.length ? (
          <Section title={p.venues.length === 1 ? "Venue" : "Venues"}>
            <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
              {p.venues.map((v, i) => (
                <li key={`${v.name}-${i}`} className="flex items-start gap-3 px-3 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-medium text-fg md:text-sm">{v.name}</span>
                    {v.type || v.notes ? (
                      <span className="block text-[13px] text-muted md:text-xs">{[v.type, v.notes].filter(Boolean).join(" · ")}</span>
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
              Why ADAR
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
            <ul className="flex flex-col gap-1">
              {p.contacts.map((c, i) => (
                <li key={i} className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-[15px] md:text-sm">
                  <span className="font-medium text-fg">{c.name}</span>
                  {c.role ? <span className="text-muted">· {c.role}</span> : null}
                  {c.email ? (
                    <a href={`mailto:${c.email}`} className="inline-flex min-w-0 items-center gap-1 text-muted hover:text-fg">
                      <Mail className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
                      <span className="truncate">{c.email}</span>
                    </a>
                  ) : null}
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
            {editHref ? (
              <Link href={editHref} scroll={false} className="inline-flex items-center gap-1 text-muted hover:text-fg">
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

function CollapseButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded
      className="inline-flex h-9 shrink-0 items-center gap-0.5 rounded-full px-2 text-[13px] text-muted active:bg-surface-2 md:h-7 md:text-xs md:hover:bg-surface-2"
    >
      Less
      <ChevronDown className="size-4 rotate-180" strokeWidth={2} aria-hidden />
    </button>
  );
}
