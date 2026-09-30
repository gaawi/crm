import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache, type ReactNode } from "react";
import { Ellipsis, ExternalLink, Pencil, Plus, Trash2, UserPlus } from "lucide-react";
import { ContactRow, RowList } from "@/components/contact-row";
import { EmailTimeline } from "@/components/email-timeline";
import { TagBadge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { ORGANIZATION_KINDS } from "@/lib/constants";
import { formatDate, formatRelative, todayIn } from "@/lib/dates";
import { env } from "@/lib/env";
import { listOpportunities } from "@/lib/queries/opportunities";
import { getOrganization, getOrganizationContacts, getOrganizationHistory } from "@/lib/queries/organizations";
import { getOwnAddresses } from "@/lib/queries/stats";
import type { Organization } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ActionForm, FormSubmit } from "../../_components/action-form";
import { DealRow } from "../../_components/deal-row";
import { Dropdown } from "../../_components/dropdown";
import { FilterForm } from "../../_components/filter-form";
import { OrganizationKindBadge, organizationKindLabel } from "../../_components/org-kind";
import { Segmented } from "../../_components/segmented";
import { BackLink, FormActions, GroupAction, GroupTitle, SearchInput, menuItemClass } from "../../_components/ui";
import { hrefWith, oneOf, param } from "../../_lib/url";
import { deleteOrganizationAction, updateOrganizationAction } from "../actions";

const HISTORY_PAGE = 30;
const TABS = ["people", "email", "deals", "info"] as const;
type Tab = (typeof TABS)[number];

const loadOrganization = cache(getOrganization);

export async function generateMetadata({ params }: PageProps<"/organizations/[id]">): Promise<Metadata> {
  const organization = await loadOrganization((await params).id);
  return { title: organization?.name ?? "Organization" };
}

function websiteHref(website: string): string {
  return /^https?:\/\//i.test(website) ? website : `https://${website}`;
}

export default async function OrganizationPage({ params, searchParams }: PageProps<"/organizations/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const organization = await loadOrganization(id);
  if (!organization) notFound();

  const timezone = env.timezone;
  const today = todayIn(timezone);
  const base = `/organizations/${organization.id}`;
  const tab: Tab = oneOf(sp, "tab", TABS) || "people";
  const q = param(sp, "q");
  const beforeRaw = param(sp, "before", 40);
  const before = beforeRaw && !Number.isNaN(Date.parse(beforeRaw)) ? new Date(beforeRaw) : undefined;
  const editing = param(sp, "edit") === "1";

  if (param(sp, "delete") === "1") {
    return (
      <div className="mx-auto max-w-2xl">
        <header className="mb-5 flex flex-col gap-3">
          <BackLink href={base} label={organization.name} />
          <h1 className="text-[28px] font-bold leading-tight tracking-tight md:text-xl md:font-semibold">Delete organization</h1>
        </header>
        <div className="flex flex-col gap-5">
          <div className="rounded-xl border border-border bg-surface p-4 md:rounded-lg">
            <p className="text-[15px] font-medium text-fg md:text-sm">Delete {organization.name}?</p>
            <p className="mt-2 text-[15px] text-muted md:text-sm">
              {organization.contactCount
                ? `Its ${organization.contactCount} ${organization.contactCount === 1 ? "contact is" : "contacts are"} kept, without an organization. `
                : null}
              Deals keep existing without it, and no email is deleted.
            </p>
          </div>
          <FormActions>
            <form action={deleteOrganizationAction.bind(null, organization.id)} className="contents">
              <SubmitButton variant="danger" pendingLabel="Deleting…">
                Delete organization
              </SubmitButton>
            </form>
            <ButtonLink href={base} variant="ghost">
              Cancel
            </ButtonLink>
          </FormActions>
        </div>
      </div>
    );
  }

  const [people, deals, history, selfEmails] = await Promise.all([
    getOrganizationContacts(organization.id),
    listOpportunities({ organizationId: organization.id, includeClosed: true }),
    getOrganizationHistory(organization.id, { limit: HISTORY_PAGE, before, q: q || undefined }),
    getOwnAddresses(),
  ]);
  const openDeals = deals.filter((d) => d.stage !== "won" && d.stage !== "lost");
  const olderHref =
    history.length === HISTORY_PAGE
      ? hrefWith(base, { tab: "email", q, before: history[history.length - 1].sentAt.toISOString() })
      : null;
  const show = (t: Tab) => (tab === t ? "flex" : "hidden md:flex");
  const addPersonHref = hrefWith("/contacts/new", { org: organization.name });
  const addDealHref = hrefWith("/pipeline", { new: 1, organization: organization.id, return: `${base}?tab=deals` });

  return (
    <>
      <header className="mb-6 flex flex-col gap-3">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <BackLink href="/organizations" label="Organizations" />
          <Dropdown label="More actions" trigger={<Ellipsis className="size-5" strokeWidth={1.75} />}>
            <Link href={`${base}?tab=info&edit=1`} className={menuItemClass}>
              <Pencil className="size-4 text-muted" strokeWidth={1.75} />
              Edit
            </Link>
            <Link href={addPersonHref} className={menuItemClass}>
              <UserPlus className="size-4 text-muted" strokeWidth={1.75} />
              Add a person
            </Link>
            <Link href={`${base}?delete=1`} className={cn(menuItemClass, "text-danger")}>
              <Trash2 className="size-4" strokeWidth={1.75} />
              Delete…
            </Link>
          </Dropdown>
        </div>
        <div className="min-w-0">
          <h1 className="text-[28px] font-bold leading-tight tracking-tight text-fg [overflow-wrap:anywhere] md:text-xl md:font-semibold">
            {organization.name}
          </h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px] text-muted md:text-sm">
            <OrganizationKindBadge kind={organization.kind} />
            {[
              organization.city ? <span key="city">{organization.city}</span> : null,
              organization.website ? (
                <a
                  key="web"
                  href={websiteHref(organization.website)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-w-0 items-center gap-1 hover:text-fg"
                >
                  <span className="truncate">{organization.website.replace(/^https?:\/\//i, "").replace(/\/$/, "")}</span>
                  <ExternalLink className="size-3 shrink-0" strokeWidth={1.75} />
                </a>
              ) : organization.domains.length ? (
                <span key="domains" className="truncate">
                  {organization.domains.map((d) => `@${d}`).join(" ")}
                </span>
              ) : null,
            ]
              .filter(Boolean)
              .map((item, i) => (
                <span key={i} className="inline-flex min-w-0 items-center gap-2">
                  {i > 0 ? <span className="text-subtle">·</span> : null}
                  {item}
                </span>
              ))}
          </div>
        </div>
      </header>

      <Segmented
        label="Sections"
        className="mb-5 md:hidden"
        segments={[
          { href: base, label: "People", active: tab === "people", count: people.length },
          { href: `${base}?tab=email`, label: "Email", active: tab === "email" },
          { href: `${base}?tab=deals`, label: "Deals", active: tab === "deals", count: openDeals.length },
          { href: `${base}?tab=info`, label: "Info", active: tab === "info" },
        ]}
      />

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem] xl:grid-cols-[minmax(0,1fr)_24rem] [&>*]:min-w-0">
        <section className={cn("flex-col", show("email"))} aria-label="Correspondence">
          <GroupTitle className="hidden md:flex">All correspondence</GroupTitle>
          <FilterForm action={base} scroll={false} role="search" aria-label="Search correspondence" className="mb-3">
            <input type="hidden" name="tab" value="email" />
            <SearchInput name="q" defaultValue={q} placeholder={`Search emails with ${organization.name}`} aria-label="Search emails" />
          </FilterForm>
          {q || before ? (
            <p className="mb-2 px-4 text-[13px] text-subtle md:px-0 md:text-xs">
              {q ? <>Emails matching “{q}”</> : "Older emails"}
              {before ? <> before {formatDate(before, timezone)}</> : null} ·{" "}
              <Link href={`${base}?tab=email`} scroll={false} className="text-muted underline-offset-2 hover:underline">
                {q ? "Clear search" : "Back to newest"}
              </Link>
            </p>
          ) : null}
          <EmailTimeline
            messages={history}
            timezone={timezone}
            selfEmails={selfEmails}
            olderHref={olderHref}
            emptyText={q ? `No emails match “${q}”.` : "No email with this organization yet."}
          />
        </section>

        <div className="flex flex-col gap-8 md:gap-7">
          <section className={cn("flex-col", show("people"))} aria-label="People">
            <GroupTitle
              actions={
                <GroupAction href={addPersonHref}>
                  <Plus className="size-4 md:size-3.5" strokeWidth={1.75} />
                  Add
                </GroupAction>
              }
            >
              People
            </GroupTitle>
            {people.length ? (
              <RowList>
                {people.map((c) => (
                  <ContactRow key={c.id} contact={c} timezone={timezone} today={today} note={c.role ?? c.primaryEmail ?? undefined} />
                ))}
              </RowList>
            ) : (
              <Empty>
                No people yet.{" "}
                <Link href={addPersonHref} className="text-fg underline-offset-2 hover:underline">
                  Add someone
                </Link>
                {organization.domains.length ? " — anyone writing from its domains is linked automatically." : null}
              </Empty>
            )}
          </section>

          <section className={cn("flex-col", show("deals"))} aria-label="Deals">
            <GroupTitle
              actions={
                <GroupAction href={addDealHref}>
                  <Plus className="size-4 md:size-3.5" strokeWidth={1.75} />
                  Add
                </GroupAction>
              }
            >
              Deals
            </GroupTitle>
            {deals.length ? (
              <RowList>
                {deals.map((d) => (
                  <DealRow key={d.id} deal={d} today={today} showContact />
                ))}
              </RowList>
            ) : (
              <Empty>
                No deals yet.{" "}
                <Link href={addDealHref} className="text-fg underline-offset-2 hover:underline">
                  Add one
                </Link>
              </Empty>
            )}
          </section>

          <section className={cn("flex-col", show("info"))} aria-label="Info">
            {editing ? (
              <EditOrganization organization={organization} cancelHref={`${base}?tab=info`} />
            ) : (
              <OrganizationInfo organization={organization} editHref={`${base}?tab=info&edit=1`} timezone={timezone} />
            )}
          </section>
        </div>
      </div>
    </>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-border px-4 py-5 text-center text-[15px] text-muted md:rounded-lg md:text-sm">
      {children}
    </div>
  );
}

function InfoRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="px-4 py-2.5 md:grid md:grid-cols-[6rem_minmax(0,1fr)] md:gap-3 md:py-2">
      <dt className="text-[13px] text-muted md:text-sm">{label}</dt>
      <dd className="mt-0.5 min-w-0 break-words text-[15px] text-fg md:mt-0 md:text-sm">{children}</dd>
    </div>
  );
}

const none = <span className="text-subtle">—</span>;

function OrganizationInfo({ organization: o, editHref, timezone }: { organization: Organization; editHref: string; timezone: string }) {
  return (
    <>
      <GroupTitle actions={<GroupAction href={editHref}>Edit</GroupAction>}>Info</GroupTitle>
      <dl className="divide-y divide-border rounded-xl border border-border bg-surface md:rounded-lg md:py-1 md:[&>div]:border-0">
        <InfoRow label="Kind">{organizationKindLabel(o.kind) ?? none}</InfoRow>
        <InfoRow label="City">{o.city || none}</InfoRow>
        <InfoRow label="Website">
          {o.website ? (
            <a href={websiteHref(o.website)} target="_blank" rel="noreferrer" className="hover:underline">
              {o.website}
            </a>
          ) : (
            none
          )}
        </InfoRow>
        <InfoRow label="Domains">{o.domains.length ? o.domains.join(", ") : none}</InfoRow>
        <InfoRow label="Tags">
          {o.tags.length ? (
            <span className="flex flex-wrap gap-1">
              {o.tags.map((t) => (
                <TagBadge key={t} tag={t} />
              ))}
            </span>
          ) : (
            none
          )}
        </InfoRow>
        <InfoRow label="Notes">{o.notes ? <p className="prose-plain">{o.notes}</p> : none}</InfoRow>
        <InfoRow label="Last contact">{o.lastContactedAt ? formatRelative(o.lastContactedAt, timezone) : none}</InfoRow>
      </dl>
    </>
  );
}

function EditOrganization({ organization: o, cancelHref }: { organization: Organization; cancelHref: string }) {
  return (
    <>
      <GroupTitle>Edit</GroupTitle>
      <ActionForm
        action={updateOrganizationAction.bind(null, o.id)}
        className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4 md:rounded-lg"
      >
        <Field label="Name" htmlFor="org-name">
          <Input id="org-name" name="name" required defaultValue={o.name} autoComplete="off" />
        </Field>
        <Field label="Kind" htmlFor="org-kind">
          <Select id="org-kind" name="kind" defaultValue={o.kind ?? ""}>
            <option value="">—</option>
            {ORGANIZATION_KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="City" htmlFor="org-city">
          <Input id="org-city" name="city" defaultValue={o.city ?? ""} autoComplete="off" />
        </Field>
        <Field label="Email domains" htmlFor="org-domains" hint="Comma separated. People writing from these domains are linked automatically.">
          <Input
            id="org-domains"
            name="domains"
            defaultValue={o.domains.join(", ")}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
          />
        </Field>
        <Field label="Website" htmlFor="org-website">
          <Input
            id="org-website"
            name="website"
            type="text"
            inputMode="url"
            defaultValue={o.website ?? ""}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder="https://"
          />
        </Field>
        <Field label="Tags" htmlFor="org-tags" hint="Comma separated.">
          <Input id="org-tags" name="tags" defaultValue={o.tags.join(", ")} autoComplete="off" autoCapitalize="off" />
        </Field>
        <Field label="Notes" htmlFor="org-notes">
          <Textarea id="org-notes" name="notes" rows={5} defaultValue={o.notes ?? ""} />
        </Field>
        <FormActions>
          <FormSubmit pendingLabel="Saving…">Save</FormSubmit>
          <ButtonLink href={cancelHref} variant="ghost" scroll={false}>
            Cancel
          </ButtonLink>
        </FormActions>
      </ActionForm>
    </>
  );
}
