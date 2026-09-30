import Link from "next/link";
import type { Metadata } from "next";
import { ArrowDownLeft, ArrowUpRight, ExternalLink } from "lucide-react";
import { ContactRow, RowList } from "@/components/contact-row";
import { AccountBadge } from "@/components/ui/badge";
import { EmptyState, PageHeader } from "@/components/ui/layout";
import { formatDateTime, formatRelative, todayIn } from "@/lib/dates";
import { env } from "@/lib/env";
import { listContacts } from "@/lib/queries/contacts";
import { searchMessages, type MessageHit } from "@/lib/queries/messages";
import { listOrganizations } from "@/lib/queries/organizations";
import { getOwnAddresses } from "@/lib/queries/stats";
import type { Address } from "@/lib/types";
import { cn } from "@/lib/utils";
import { FilterForm } from "../_components/filter-form";
import { organizationKindLabel } from "../_components/org-kind";
import { GroupAction, GroupTitle, SearchInput } from "../_components/ui";
import { hrefWith, param } from "../_lib/url";

export const metadata: Metadata = { title: "Search" };

const CONTACT_LIMIT = 8;
const ORGANIZATION_LIMIT = 8;
const EMAIL_LIMIT = 30;

export default async function SearchPage({ searchParams }: PageProps<"/search">) {
  const sp = await searchParams;
  const q = param(sp, "q");
  const timezone = env.timezone;
  const today = todayIn(timezone);

  const [contactResult, organizations, emails, selfEmails] = q
    ? await Promise.all([
        listContacts({ q, status: "all", limit: CONTACT_LIMIT }),
        listOrganizations({ q, limit: ORGANIZATION_LIMIT + 1 }),
        searchMessages({ q, limit: EMAIL_LIMIT }),
        getOwnAddresses(),
      ])
    : [null, [], [], new Set<string>()];
  const contacts = contactResult?.contacts ?? [];
  const nothing = q && !contacts.length && !organizations.length && !emails.length;

  return (
    <div className="max-w-3xl">
      <PageHeader title="Search" />
      <FilterForm action="/search" role="search" aria-label="Search everything" className="mb-6">
        <SearchInput
          name="q"
          defaultValue={q}
          placeholder="People, organizations, emails"
          aria-label="Search contacts, organizations and emails"
          autoFocus={!q}
        />
      </FilterForm>

      {!q ? (
        <p className="px-4 text-[15px] text-muted md:px-0 md:text-sm">
          Search names, addresses, organizations, roles and tags, and the full text of every synced email.
        </p>
      ) : nothing ? (
        <EmptyState title={`Nothing found for “${q}”`}>
          Try fewer words or a different spelling. Email search matches whole words (and their forms: “concert” finds
          “concerts”).
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-8">
          {contacts.length ? (
            <section aria-label="Contacts">
              <GroupTitle
                actions={
                  contactResult && contactResult.total > contacts.length ? (
                    <GroupAction href={hrefWith("/contacts", { q, status: "all" })}>See all {contactResult.total}</GroupAction>
                  ) : undefined
                }
              >
                Contacts
              </GroupTitle>
              <RowList>
                {contacts.map((c) => (
                  <ContactRow key={c.id} contact={c} timezone={timezone} today={today} showStatus={c.status === "archived"} />
                ))}
              </RowList>
            </section>
          ) : null}

          {organizations.length ? (
            <section aria-label="Organizations">
              <GroupTitle
                actions={
                  organizations.length > ORGANIZATION_LIMIT ? (
                    <GroupAction href={hrefWith("/organizations", { q })}>See all</GroupAction>
                  ) : undefined
                }
              >
                Organizations
              </GroupTitle>
              <RowList>
                {organizations.slice(0, ORGANIZATION_LIMIT).map((o) => (
                  <li key={o.id} className="relative flex min-h-[52px] items-center gap-3 px-4 py-2.5 active:bg-surface-2 md:min-h-0 md:hover:bg-surface-2/40">
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/organizations/${o.id}`}
                        className="block truncate text-[15px] font-medium text-fg after:absolute after:inset-0 md:text-sm"
                      >
                        {o.name}
                      </Link>
                      <p className="truncate text-[13px] text-muted md:text-xs">
                        {[
                          organizationKindLabel(o.kind),
                          o.city,
                          `${o.contactCount} ${o.contactCount === 1 ? "person" : "people"}`,
                          o.domains.join(", "),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                    <span className="shrink-0 text-[13px] text-subtle md:text-xs">
                      {o.lastContactedAt ? formatRelative(o.lastContactedAt, timezone) : null}
                    </span>
                  </li>
                ))}
              </RowList>
            </section>
          ) : null}

          {emails.length ? (
            <section aria-label="Emails">
              <GroupTitle>
                Emails{" "}
                <span className="ml-1 normal-case tracking-normal">{emails.length === EMAIL_LIMIT ? `${EMAIL_LIMIT}+` : emails.length}</span>
              </GroupTitle>
              <ol className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface md:rounded-lg">
                {emails.map((m) => (
                  <EmailHit key={m.id} message={m} timezone={timezone} selfEmails={selfEmails} />
                ))}
              </ol>
              {emails.length === EMAIL_LIMIT ? (
                <p className="mt-2 px-4 text-[13px] text-subtle md:px-0 md:text-xs">Showing the {EMAIL_LIMIT} most recent matches. Add words to narrow it down.</p>
              ) : null}
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}

function who(address: Address | null | undefined, selfEmails: ReadonlySet<string>): string {
  if (!address) return "Unknown";
  if (selfEmails.has(address.email)) return "You";
  return address.name || address.email;
}

function EmailHit({ message: m, timezone, selfEmails }: { message: MessageHit; timezone: string; selfEmails: ReadonlySet<string> }) {
  const outbound = m.direction === "outbound";
  const Icon = outbound ? ArrowUpRight : ArrowDownLeft;
  const to = m.to[0] ? `${who(m.to[0], selfEmails)}${m.to.length + m.cc.length > 1 ? ` +${m.to.length + m.cc.length - 1}` : ""}` : "";
  return (
    <li>
      <details className="group">
        <summary className="flex cursor-pointer list-none gap-3 px-4 py-3 active:bg-surface-2 md:hover:bg-surface-2/60 [&::-webkit-details-marker]:hidden">
          <Icon className={cn("mt-0.5 size-4 shrink-0", outbound ? "text-subtle" : "text-fg")} strokeWidth={1.75} aria-label={outbound ? "Sent" : "Received"} />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-baseline gap-2">
              <span className="min-w-0 truncate text-[15px] font-medium text-fg md:text-sm">{who(m.from, selfEmails)}</span>
              {to ? <span className="min-w-0 truncate text-[13px] text-subtle md:text-xs">→ {to}</span> : null}
              <span className="ml-auto shrink-0 text-[13px] text-subtle md:text-xs" title={formatDateTime(m.sentAt, timezone)}>
                {formatRelative(m.sentAt, timezone)}
              </span>
            </div>
            <p className="truncate text-[15px] text-fg md:text-sm">{m.subject || "(no subject)"}</p>
            <p className="line-clamp-2 text-[13px] text-muted group-open:hidden md:line-clamp-1 md:text-xs">{m.snippet}</p>
          </div>
        </summary>
        <div className="border-t border-border bg-bg/40 px-4 py-3 md:pl-11">
          <div className="mb-3 flex flex-wrap items-center gap-1.5 text-[13px] text-muted md:text-xs">
            <span>{formatDateTime(m.sentAt, timezone)}</span>
            <span className="text-subtle">·</span>
            {m.accounts.map((account) => (
              <AccountBadge key={account} email={account} />
            ))}
            <a href={m.gmailUrl} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 hover:text-fg">
              Open in Gmail <ExternalLink className="size-3" strokeWidth={1.75} />
            </a>
          </div>
          {m.contacts.length ? (
            <div className="mb-3 flex flex-wrap gap-1.5">
              {m.contacts.map((c) => (
                <Link
                  key={c.id}
                  href={`/contacts/${c.id}`}
                  className="inline-flex h-8 max-w-full items-center rounded-full bg-surface-2 px-3 text-[13px] text-fg active:opacity-60 md:h-6 md:px-2 md:text-xs md:hover:opacity-80"
                >
                  <span className="truncate">{c.displayName}</span>
                </Link>
              ))}
            </div>
          ) : null}
          <div className="prose-plain text-[15px] leading-relaxed text-fg md:text-sm">
            {m.bodyText || m.snippet || <span className="text-muted">No text content.</span>}
          </div>
        </div>
      </details>
    </li>
  );
}
