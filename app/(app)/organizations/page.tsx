import Link from "next/link";
import type { Metadata } from "next";
import { ButtonLink } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { EmptyState, PageHeader } from "@/components/ui/layout";
import { ORGANIZATION_KINDS } from "@/lib/constants";
import { formatDateTime, formatRelative } from "@/lib/dates";
import { env } from "@/lib/env";
import { listOrganizations } from "@/lib/queries/organizations";
import type { Organization } from "@/lib/types";
import { ActionForm, FormSubmit } from "../_components/action-form";
import { FilterForm } from "../_components/filter-form";
import {
  ORGANIZATION_FILTERS,
  matchesOrganizationFilter,
  organizationKindLabel,
  OrganizationKindBadge,
  type OrganizationFilter,
} from "../_components/org-kind";
import { Segmented } from "../_components/segmented";
import { FormActions, GroupTitle, HeaderAddButton, SearchInput } from "../_components/ui";
import { hrefWith, oneOf, param } from "../_lib/url";
import { createOrganizationAction } from "./actions";

export const metadata: Metadata = { title: "Organizations" };

export default async function OrganizationsPage({ searchParams }: PageProps<"/organizations">) {
  const sp = await searchParams;
  const q = param(sp, "q");
  const kind = oneOf(sp, "kind", ORGANIZATION_FILTERS.map((f) => f.value)) as OrganizationFilter;
  const creating = param(sp, "new") === "1";
  const timezone = env.timezone;

  // One query for every segment; the kind filter ("Other" groups several kinds) runs here.
  const all = await listOrganizations({ q: q || undefined, limit: 500 });
  const organizations = all.filter((o) => matchesOrganizationFilter(o.kind, kind));
  const counts = new Map(ORGANIZATION_FILTERS.map((f) => [f.value, all.filter((o) => matchesOrganizationFilter(o.kind, f.value)).length]));

  return (
    <>
      <PageHeader
        title="Organizations"
        description={<span className="hidden md:inline">Venues, funders, partners and press you work with.</span>}
        actions={<HeaderAddButton href={hrefWith("/organizations", { q, kind, new: 1 })} label="New organization" />}
      />

      {creating ? <NewOrganizationForm cancelHref={hrefWith("/organizations", { q, kind })} /> : null}

      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center">
        <FilterForm action="/organizations" role="search" aria-label="Search organizations" className="md:w-72">
          {kind ? <input type="hidden" name="kind" value={kind} /> : null}
          <SearchInput name="q" defaultValue={q} placeholder="Search name, city or domain" aria-label="Search organizations" />
        </FilterForm>
        <Segmented
          label="Kind"
          fill={false}
          phoneCounts={false}
          equal={false}
          segments={ORGANIZATION_FILTERS.map((f) => ({
            href: hrefWith("/organizations", { q, kind: f.value }),
            label: f.label,
            active: kind === f.value,
            count: f.value ? counts.get(f.value) : undefined,
          }))}
        />
      </div>

      {organizations.length ? (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface md:rounded-lg">
          <li aria-hidden className="hidden items-center gap-3 px-4 py-2 text-xs font-medium text-subtle md:flex">
            <span className="flex-1">Name</span>
            <span className="w-24 shrink-0">Kind</span>
            <span className="hidden w-32 shrink-0 lg:block">City</span>
            <span className="hidden w-48 shrink-0 xl:block">Domains</span>
            <span className="w-16 shrink-0 text-right">People</span>
            <span className="w-24 shrink-0 text-right">Last contact</span>
          </li>
          {organizations.map((o) => (
            <OrganizationRow key={o.id} organization={o} timezone={timezone} />
          ))}
        </ul>
      ) : q || kind ? (
        <EmptyState title="No organizations match" action={<ButtonLink href="/organizations">Show all</ButtonLink>}>
          {q ? <>Nothing matches “{q}”{kind ? " in this group" : ""}.</> : "None of this kind yet."}
        </EmptyState>
      ) : (
        <EmptyState
          title="No organizations yet"
          action={
            <ButtonLink href="/organizations?new=1" variant="primary">
              New organization
            </ButtonLink>
          }
        >
          Add the venues, foundations and publications you work with. Contacts whose address matches an organization&rsquo;s
          domain are linked to it automatically.
        </EmptyState>
      )}
    </>
  );
}

function OrganizationRow({ organization: o, timezone }: { organization: Organization; timezone: string }) {
  const kind = organizationKindLabel(o.kind);
  const phoneSubtitle = [kind, o.city, `${o.contactCount} ${o.contactCount === 1 ? "person" : "people"}`].filter(Boolean).join(" · ");
  return (
    <li className="relative flex min-h-[60px] items-center gap-3 px-4 py-2.5 active:bg-surface-2 md:min-h-0 md:hover:bg-surface-2/40 md:active:bg-surface-2/40">
      <div className="min-w-0 flex-1">
        <Link
          href={`/organizations/${o.id}`}
          className="block truncate text-[15px] font-medium text-fg after:absolute after:inset-0 md:text-sm md:hover:underline"
        >
          {o.name}
        </Link>
        <p className="truncate text-[13px] text-muted md:hidden">{phoneSubtitle}</p>
        {o.domains.length ? (
          <p className="truncate text-[13px] text-subtle md:text-xs md:text-muted xl:hidden">{o.domains.join(", ")}</p>
        ) : null}
      </div>
      <span className="hidden w-24 shrink-0 md:block">
        <OrganizationKindBadge kind={o.kind} />
      </span>
      <span className="hidden w-32 shrink-0 truncate text-xs text-muted lg:block">{o.city}</span>
      <span className="hidden w-48 shrink-0 truncate text-xs text-muted xl:block">{o.domains.join(", ")}</span>
      <span className="hidden w-16 shrink-0 text-right text-xs tabular-nums text-muted md:block">{o.contactCount || "—"}</span>
      <span
        className="shrink-0 text-[13px] text-subtle md:w-24 md:text-right md:text-xs md:text-muted"
        title={o.lastContactedAt ? formatDateTime(o.lastContactedAt, timezone) : undefined}
      >
        {o.lastContactedAt ? formatRelative(o.lastContactedAt, timezone) : "—"}
      </span>
    </li>
  );
}

function NewOrganizationForm({ cancelHref }: { cancelHref: string }) {
  return (
    <section className="mb-6" aria-label="New organization">
      <GroupTitle>New organization</GroupTitle>
      <ActionForm action={createOrganizationAction} className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4 md:rounded-lg">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Name" htmlFor="org-name">
            <Input id="org-name" name="name" required autoFocus autoComplete="off" autoCapitalize="words" placeholder="Carnegie Hall" />
          </Field>
          <Field label="Kind" htmlFor="org-kind">
            <Select id="org-kind" name="kind" defaultValue="">
              <option value="">—</option>
              {ORGANIZATION_KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                  {k.hint ? ` — ${k.hint}` : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="City" htmlFor="org-city">
            <Input id="org-city" name="city" autoComplete="off" placeholder="New York" />
          </Field>
          <Field label="Email domains" htmlFor="org-domains" hint="People writing from these domains are linked automatically.">
            <Input
              id="org-domains"
              name="domains"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              placeholder="carnegiehall.org"
            />
          </Field>
        </div>
        <FormActions>
          <FormSubmit pendingLabel="Creating…">Create organization</FormSubmit>
          <ButtonLink href={cancelHref} variant="ghost">
            Cancel
          </ButtonLink>
        </FormActions>
      </ActionForm>
    </section>
  );
}
