"use client";

import Link from "next/link";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ChevronRight,
  ExternalLink,
  Landmark,
  Mail,
  MessageCircle,
  Music,
  Phone,
  Search,
  StickyNote,
  Target,
  Users,
} from "lucide-react";
import { ContactAvatar } from "@/components/contact-avatar";
import { OrgLogo } from "@/components/organizations/org-logo";
import { OrgProfileCard } from "@/components/organizations/profile-card";
import { ProjectDot, StatusBadge, TagBadge } from "@/components/ui/badge";
import { formatPhone, telHref, whatsappUrl } from "@/lib/booking/phone";
import { CARD_FIELD_LABEL } from "@/lib/contacts/card";
import { PROFILE_KIND_LABEL } from "@/lib/organizations/profile";
import { formatDate, formatRelative } from "@/lib/dates";
import type { EmailDraft } from "@/lib/types";
import type { CardInfo } from "./card-info";

const ACTIVITY_LABEL: Record<string, string> = {
  call: "Call",
  whatsapp: "WhatsApp",
  meeting: "Meeting",
  email: "Email",
  note: "Note",
  status: "Status",
};

/** The back of a flashcard: the contact card, the goal, recent emails and calls, the organization. */
export function CardBack({ draft, info, timezone }: { draft: EmailDraft; info: CardInfo; timezone: string }) {
  const c = info.contact;
  const g = info.goal;
  const wa = c ? whatsappUrl({ phone: c.phone, whatsapp: c.whatsapp }) : null;
  return (
    <div className="flex flex-col gap-4 px-4 py-3 text-[13px] leading-snug">
      <CardHero draft={draft} info={info} timezone={timezone} />

      {c ? (
        <section className="flex flex-col gap-1">
          {c.emails.map((e) => (
            <a key={e} href={`mailto:${e}`} className="flex items-center gap-2 text-fg/90 hover:underline">
              <Mail className="size-3.5 shrink-0 text-subtle" aria-hidden />
              <span className="truncate">{e}</span>
            </a>
          ))}
          {c.phone ? (
            <a href={telHref(c.phone) ?? undefined} className="flex items-center gap-2 text-fg/90 hover:underline">
              <Phone className="size-3.5 shrink-0 text-subtle" aria-hidden />
              {formatPhone(c.phone)}
            </a>
          ) : null}
          {wa ? (
            <a href={wa} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-fg/90 hover:underline">
              <MessageCircle className="size-3.5 shrink-0 text-subtle" aria-hidden />
              WhatsApp
            </a>
          ) : null}
          {c.tags.length ? (
            <div className="mt-1 flex flex-wrap gap-1">
              {c.tags.map((t) => (
                <TagBadge key={t} tag={t} />
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      <SeriesAtAGlance organization={draft.organization ?? null} />

      {g ? (
        <section className="rounded-lg bg-surface-2 px-3 py-2">
          <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-subtle">
            <Target className="size-3.5" aria-hidden /> Goal{g.project ? ` · ${g.project}` : ""}
          </p>
          <p className="mt-0.5 font-medium">{g.title}</p>
          <p className="text-muted">
            {g.kind} · {g.stage}
            {g.value ? ` · ${Number(g.value).toLocaleString("en-US")} ${g.currency}` : ""}
          </p>
          {g.nextAction || g.nextStep ? (
            <p className="mt-1">
              <span className="text-subtle">Next: </span>
              {[g.nextAction, g.nextStep].filter(Boolean).join(": ")}
              {g.followUpAt ? <span className="text-subtle"> · {formatDate(new Date(`${g.followUpAt}T12:00:00Z`), timezone)}</span> : null}
            </p>
          ) : null}
          {g.notes ? <p className="prose-plain mt-1 line-clamp-4 text-muted">{g.notes}</p> : null}
        </section>
      ) : null}

      {info.musician ? (
        <section className="flex items-start gap-2">
          <Music className="mt-0.5 size-3.5 shrink-0 text-subtle" aria-hidden />
          <p>
            {info.musician.instruments.join(", ") || "Musician"} · {info.musician.roster}
            {info.musician.basedIn ? ` · ${info.musician.basedIn}` : ""}
            {info.musician.website ? (
              <>
                {" · "}
                <a
                  href={info.musician.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-0.5 hover:underline"
                >
                  web <ExternalLink className="size-3" aria-hidden />
                </a>
              </>
            ) : null}
          </p>
        </section>
      ) : null}

      {c?.notes ? (
        <section className="flex items-start gap-2">
          <StickyNote className="mt-0.5 size-3.5 shrink-0 text-subtle" aria-hidden />
          <p className="prose-plain line-clamp-6 text-muted">{c.notes}</p>
        </section>
      ) : null}

      {c ? (
        <section className="flex items-start gap-2 text-[12px] text-subtle">
          <Search className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <p>
            {c.researchedAt ? `Card filled ${formatRelative(new Date(c.researchedAt), timezone)}` : "Card not researched yet"}
            {c.researchSources.length ? " from " : ""}
            {c.researchSources.slice(0, 4).map((url, i) => (
              <span key={url}>
                {i ? ", " : ""}
                <a href={url} target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:underline">
                  {hostOf(url)}
                </a>
              </span>
            ))}
            {c.cardMissing.length ? `. Missing: ${c.cardMissing.map((f) => CARD_FIELD_LABEL[f]).join(", ")}.` : "."}
          </p>
        </section>
      ) : null}

      {info.emails.length || info.activities.length ? (
        <section>
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-subtle">Latest</p>
          <ul className="flex flex-col divide-y divide-border">
            {info.activities.map((a) => (
              <li key={a.id} className="py-1.5">
                <span className="font-medium">{ACTIVITY_LABEL[a.kind] ?? a.kind}</span>
                {a.outcome ? <span className="text-muted"> · {a.outcome.replace(/_/g, " ")}</span> : null}
                <span className="text-subtle"> · {formatRelative(new Date(a.occurredAt), timezone)}</span>
                {a.body ? <p className="line-clamp-2 text-muted">{a.body}</p> : null}
              </li>
            ))}
            {info.emails.map((m) => (
              <li key={m.id} className="py-1.5">
                <span className="flex items-center gap-1">
                  {m.direction === "inbound" ? (
                    <ArrowDownLeft className="size-3.5 shrink-0 text-success" aria-label="From them" />
                  ) : (
                    <ArrowUpRight className="size-3.5 shrink-0 text-subtle" aria-label="From you" />
                  )}
                  <span className="min-w-0 flex-1 truncate font-medium">{m.subject || "(no subject)"}</span>
                  <span className="shrink-0 text-[12px] text-subtle">{formatRelative(new Date(m.sentAt), timezone)}</span>
                </span>
                {m.snippet ? <p className="line-clamp-2 text-muted">{m.snippet}</p> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {draft.organization?.profile ? (
        <OrgProfileCard
          profile={draft.organization.profile}
          organization={draft.organization}
          orgHref={`/organizations/${draft.organization.id}`}
          className="text-[13px]"
        />
      ) : null}

      {c ? (
        <Link href={`/contacts/${c.id}`} className="text-center text-[13px] text-brand hover:underline">
          Open contact →
        </Link>
      ) : null}
    </div>
  );
}

/**
 * The top of the back: the contact's photo with the organization's logo on
 * its right, then the organization (tap it to open its page) with what kind
 * it is, and the contact's role and standing. The name is in the card's
 * header already, so it is not repeated here.
 */
function CardHero({ draft, info, timezone }: { draft: EmailDraft; info: CardInfo; timezone: string }) {
  const c = info.contact;
  const org = draft.organization ?? c?.organization ?? null;
  const profile = draft.organization?.profile;
  if (!c && !org) return <p className="text-muted">To {draft.to.join(", ")}, not linked to a contact yet.</p>;
  const orgHref = org ? `/organizations/${org.id}` : null;
  return (
    <section className="flex flex-col gap-2.5" data-testid="card-hero">
      <div className="flex items-center gap-2">
        {c ? <ContactAvatar contact={c} size="lg" zoomable photoSource={c.photoSource} className="md:size-16" /> : null}
        {org && orgHref ? (
          <Link href={orgHref} aria-label={`Open ${org.name}`} className="rounded-xl active:opacity-80">
            <OrgLogo name={org.name} logo={profile?.logo} size="lg" className="md:size-16" />
          </Link>
        ) : null}
      </div>
      {org && orgHref ? (
        <div>
          <Link href={orgHref} className="group inline-flex max-w-full items-start gap-1">
            <span className="min-w-0 text-[17px] font-semibold leading-tight group-hover:underline">{org.name}</span>
            <ChevronRight className="mt-0.5 size-4 shrink-0 text-subtle" aria-hidden />
          </Link>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1">
            {profile?.kind ? (
              <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-brand">
                {PROFILE_KIND_LABEL[profile.kind]}
              </span>
            ) : null}
            {profile?.tagline ? <span className="text-muted">{profile.tagline}</span> : null}
          </p>
        </div>
      ) : null}
      {c ? (
        <div>
          <p className="text-fg/90">
            {c.role || (
              <Link href={`/contacts/${c.id}`} className="hover:underline">
                {c.displayName}
              </Link>
            )}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <StatusBadge status={c.status} />
            {c.projects.map((p) => (
              <span key={p.id} className="inline-flex items-center gap-1 text-[12px] text-muted">
                <ProjectDot color={p.color} />
                {p.name}
              </span>
            ))}
          </div>
          <p className="mt-1 text-[12px] text-subtle">
            {c.messageCount} {c.messageCount === 1 ? "email" : "emails"} · last{" "}
            {c.lastContactedAt ? formatRelative(new Date(c.lastContactedAt), timezone) : "never"}
            {c.followUpAt ? ` · follow up ${formatDate(new Date(`${c.followUpAt}T12:00:00Z`), timezone)}` : ""}
          </p>
        </div>
      ) : null}
    </section>
  );
}

/**
 * What the owner checks before approving: what kind of series it is, the
 * hall (type, size, piano), which kinds of groups they present and who has
 * played there. Says plainly what is still unknown.
 */
function SeriesAtAGlance({ organization }: { organization: EmailDraft["organization"] | null }) {
  const p = organization?.profile;
  if (!organization || !p) {
    return (
      <section className="rounded-lg border border-dashed border-border px-3 py-2 text-[12.5px] text-muted">
        No profile of {organization?.name ?? "the organization"} yet: the kind of series, the hall and who has played there appear here once
        researched.
      </section>
    );
  }
  const missing = [!p.venues?.length && "the hall", !p.formats?.length && "the groups they present", !p.artists?.length && "who has played"].filter(
    Boolean,
  ) as string[];
  return (
    <section className="flex flex-col gap-2 rounded-lg bg-surface-2 px-3 py-2.5">
      {p.venues?.length ? (
        <div>
          <p className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-subtle">
            <Landmark className="size-3.5" aria-hidden /> {p.venues.length === 1 ? "Hall" : "Halls"}
          </p>
          <ul className="mt-0.5 flex flex-col gap-0.5">
            {p.venues.map((v, i) => (
              <li key={i}>
                <span className="font-medium">{v.name}</span>
                {[v.type, v.capacity ? `${v.capacity} seats` : null, v.notes].filter(Boolean).map((x, j) => (
                  <span key={j} className="text-muted">
                    {" · "}
                    {x}
                  </span>
                ))}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {p.formats?.length ? (
        <div>
          <p className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-subtle">
            <Users className="size-3.5" aria-hidden /> Groups they present
          </p>
          <ul className="mt-1 flex flex-wrap gap-1">
            {p.formats.map((f, i) => (
              <li key={i} className="rounded-full bg-surface px-2 py-0.5 text-[12px]">
                {f}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {p.artists?.length ? (
        <div>
          <p className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-subtle">
            <Music className="size-3.5" aria-hidden /> Who has played
          </p>
          <ul className="mt-0.5 flex flex-col gap-0.5">
            {p.artists.slice(0, 10).map((a, i) => (
              <li key={i}>
                <span className="font-medium">{a.name}</span>
                {a.formation ? <span className="text-muted"> · {a.formation}</span> : null}
                {a.date ? <span className="text-subtle"> · {a.date}</span> : null}
              </li>
            ))}
          </ul>
          {p.artists.length > 10 ? <p className="text-[12px] text-subtle">and {p.artists.length - 10} more in the full profile below</p> : null}
        </div>
      ) : null}

      {missing.length ? <p className="text-[12px] text-warning">Not researched yet: {missing.join(", ")}.</p> : null}
    </section>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
