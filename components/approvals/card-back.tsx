"use client";

import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, ExternalLink, Mail, MessageCircle, Music, Phone, StickyNote, Target } from "lucide-react";
import { ContactAvatar } from "@/components/contact-avatar";
import { OrgProfileCard } from "@/components/organizations/profile-card";
import { ProjectDot, StatusBadge, TagBadge } from "@/components/ui/badge";
import { formatPhone, telHref, whatsappUrl } from "@/lib/booking/phone";
import { formatDate, formatRelative } from "@/lib/dates";
import type { EmailDraft } from "@/lib/types";
import type { CardInfo } from "./card-info";

const ACTIVITY_LABEL: Record<string, string> = { call: "Call", whatsapp: "WhatsApp", meeting: "Meeting", email: "Email", note: "Note", status: "Status" };

/** The back of a flashcard: the contact card, the goal, recent emails and calls, the organization. */
export function CardBack({ draft, info, timezone }: { draft: EmailDraft; info: CardInfo; timezone: string }) {
  const c = info.contact;
  const g = info.goal;
  const wa = c ? whatsappUrl({ phone: c.phone, whatsapp: c.whatsapp }) : null;
  return (
    <div className="flex flex-col gap-4 px-4 py-3 text-[13px] leading-snug">
      {c ? (
        <section className="flex items-start gap-3">
          <ContactAvatar contact={c} size="lg" zoomable photoSource={c.photoSource} className="md:size-16" />
          <div className="min-w-0 flex-1">
            <Link href={`/contacts/${c.id}`} className="text-[17px] font-semibold leading-tight hover:underline">
              {c.displayName}
            </Link>
            {c.role || c.organization ? (
              <p className="text-muted">
                {c.role}
                {c.role && c.organization ? " · " : ""}
                {c.organization ? (
                  <Link href={`/organizations/${c.organization.id}`} className="hover:underline">
                    {c.organization.name}
                  </Link>
                ) : null}
              </p>
            ) : null}
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <StatusBadge status={c.status} />
              {c.projects.map((p) => (
                <span key={p.id} className="inline-flex items-center gap-1 text-[12px] text-muted">
                  <ProjectDot color={p.color} />
                  {p.name}
                </span>
              ))}
            </div>
            <p className="mt-1 text-[12px] text-subtle">
              {c.messageCount} {c.messageCount === 1 ? "email" : "emails"} · last {c.lastContactedAt ? formatRelative(new Date(c.lastContactedAt), timezone) : "never"}
              {c.followUpAt ? ` · follow up ${formatDate(new Date(`${c.followUpAt}T12:00:00Z`), timezone)}` : ""}
            </p>
          </div>
        </section>
      ) : (
        <p className="text-muted">To {draft.to.join(", ")} — not linked to a contact yet.</p>
      )}

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
              {[g.nextAction, g.nextStep].filter(Boolean).join(" — ")}
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
                <a href={info.musician.website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 hover:underline">
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
