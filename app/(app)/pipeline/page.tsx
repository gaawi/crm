import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, ChevronRight, X } from "lucide-react";
import { ProjectDot, StageBadge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { EmptyState, PageHeader } from "@/components/ui/layout";
import { OPEN_STAGES, OPPORTUNITY_KINDS, OPPORTUNITY_STAGES, stageLabel } from "@/lib/constants";
import { formatDate, formatDue, todayIn } from "@/lib/dates";
import { env } from "@/lib/env";
import { getContact, listContacts } from "@/lib/queries/contacts";
import { getOpportunity, listOpportunities } from "@/lib/queries/opportunities";
import { listOrganizations } from "@/lib/queries/organizations";
import { listProjects } from "@/lib/queries/projects";
import type { Opportunity, OpportunityKind, OpportunityStage, Project } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ActionForm, FormSubmit } from "../_components/action-form";
import { ConfirmAction } from "../_components/confirm-action";
import { FilterForm } from "../_components/filter-form";
import { Segmented } from "../_components/segmented";
import { FormActions, GroupTitle, HeaderAddButton } from "../_components/ui";
import { formatMoney, totalMoney } from "../_lib/format";
import { hrefWith, oneOf, param } from "../_lib/url";
import { isId, safeReturnPath } from "../_lib/validation";
import { advanceDeal, deleteDeal, saveDeal } from "./actions";

export const metadata: Metadata = { title: "Pipeline" };

/** The kind filter. "other" groups sales and other deals. */
const KIND_FILTERS = [
  { value: "", label: "All" },
  { value: "booking", label: "Booking" },
  { value: "fundraising", label: "Fundraising" },
  { value: "partnership", label: "Partnerships" },
  { value: "grant", label: "Grants" },
  { value: "press", label: "Press" },
  { value: "other", label: "Other" },
] as const;
type KindFilter = (typeof KIND_FILTERS)[number]["value"];

const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "MXN", "CHF", "AUD", "JPY"];
const CLOSED_LIMIT = 10;

function matchesKind(kind: OpportunityKind, filter: KindFilter): boolean {
  if (!filter) return true;
  if (filter === "other") return kind === "other" || kind === "sale";
  return kind === filter;
}

/** Column/segment names: kind-specific when one kind is selected, generic for "All". */
function columnLabel(stage: OpportunityStage, filter: KindFilter): string {
  return filter && filter !== "other" ? stageLabel(stage, filter) : OPPORTUNITY_STAGES.find((s) => s.value === stage)!.label;
}

function nextStage(stage: OpportunityStage): OpportunityStage | null {
  const index = OPEN_STAGES.indexOf(stage);
  if (index === -1) return null;
  return OPEN_STAGES[index + 1] ?? "won";
}

export default async function PipelinePage({ searchParams }: PageProps<"/pipeline">) {
  const sp = await searchParams;
  const kind = oneOf(sp, "kind", KIND_FILTERS.map((k) => k.value)) as KindFilter;
  const projectId = isId(param(sp, "project")) ? param(sp, "project") : "";
  const openId = isId(param(sp, "open")) ? param(sp, "open") : "";
  const creating = param(sp, "new") === "1";
  const timezone = env.timezone;
  const today = todayIn(timezone);

  const [all, projects] = await Promise.all([
    listOpportunities({ includeClosed: true, projectId: projectId || undefined }),
    listProjects({ includeArchived: true }),
  ]);
  const deals = all.filter((d) => matchesKind(d.kind, kind));
  const byStage = new Map<OpportunityStage, Opportunity[]>(OPEN_STAGES.map((s) => [s, deals.filter((d) => d.stage === s)]));
  const closedSorted = (stage: OpportunityStage) =>
    deals
      .filter((d) => d.stage === stage)
      .sort((a, b) => (b.closedAt?.getTime() ?? 0) - (a.closedAt?.getTime() ?? 0))
      .slice(0, CLOSED_LIMIT);
  const won = closedSorted("won");
  const lost = closedSorted("lost");

  const firstWithDeals = OPEN_STAGES.find((s) => byStage.get(s)!.length) ?? "lead";
  const stage = (oneOf(sp, "stage", OPEN_STAGES) || firstWithDeals) as OpportunityStage;
  const filters = { kind, project: projectId, stage: oneOf(sp, "stage", OPEN_STAGES) };
  const boardHref = hrefWith("/pipeline", filters);
  const openHref = (id: string) => hrefWith("/pipeline", { ...filters, open: id });
  const newHref = hrefWith("/pipeline", { ...filters, new: 1 });
  const activeProjects = projects.filter((p) => !p.archived || p.id === projectId);

  const sheet = openId || creating ? await loadSheet() : null;

  async function loadSheet() {
    const deal = openId ? await getOpportunity(openId) : null;
    if (openId && !deal) return null;
    const prefillContactId = !deal && isId(param(sp, "contact")) ? param(sp, "contact") : "";
    const [contacts, organizations, prefillContact] = await Promise.all([
      listContacts({ sort: "name", limit: 500 }),
      listOrganizations({ limit: 500 }),
      prefillContactId ? getContact(prefillContactId) : null,
    ]);
    return { deal, contacts: contacts.contacts, organizations, prefillContact };
  }

  const returnParam = safeReturnPath(param(sp, "return", 500), "");
  const closeHref = returnParam || boardHref;

  return (
    <>
      <PageHeader
        title="Pipeline"
        description={<span className="hidden md:inline">{summary(OPEN_STAGES.flatMap((s) => byStage.get(s)!), "open")}</span>}
        actions={<HeaderAddButton href={newHref} label="New deal" />}
      />

      {/* Filters. Desktop: kind segments + project select; phone: two selects. */}
      <div className="mb-5 hidden items-center gap-3 md:flex">
        <Segmented
          label="Kind"
          fill={false}
          segments={KIND_FILTERS.map((k) => ({
            href: hrefWith("/pipeline", { kind: k.value, project: projectId }),
            label: k.label,
            active: kind === k.value,
          }))}
        />
        <FilterForm action="/pipeline" aria-label="Filter by project" className="ml-auto">
          {kind ? <input type="hidden" name="kind" value={kind} /> : null}
          <ProjectSelect projects={activeProjects} value={projectId} className="w-48" />
        </FilterForm>
      </div>
      <FilterForm action="/pipeline" aria-label="Filter deals" className="mb-3 grid grid-cols-2 gap-2 md:hidden">
        <Select name="kind" defaultValue={kind} aria-label="Kind">
          {KIND_FILTERS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.value ? k.label : "All kinds"}
            </option>
          ))}
        </Select>
        <ProjectSelect projects={activeProjects} value={projectId} />
      </FilterForm>

      {deals.length === 0 && !kind && !projectId ? (
        <EmptyState title="No deals yet" action={<ButtonLink href={newHref} variant="primary">New deal</ButtonLink>}>
          Track bookings, fundraising asks, grants and press from first contact to confirmed.
        </EmptyState>
      ) : (
        <>
          {/* Phone: one stage at a time. */}
          <div className="md:hidden">
            <Segmented
              label="Stage"
              phoneCounts={false}
              equal={false}
              className="mb-2"
              segments={OPEN_STAGES.map((s) => ({
                href: hrefWith("/pipeline", { kind, project: projectId, stage: s }),
                label: columnLabel(s, kind),
                active: stage === s,
              }))}
            />
            <p className="mb-3 px-4 text-[13px] text-subtle">
              {summary(byStage.get(stage)!)}
            </p>
            {byStage.get(stage)!.length ? (
              <div className="flex flex-col gap-2.5">
                {byStage.get(stage)!.map((d) => (
                  <DealCard key={d.id} deal={d} today={today} href={openHref(d.id)} showKind={!kind} />
                ))}
              </div>
            ) : (
              <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-[15px] text-muted">
                Nothing in {columnLabel(stage, kind)}.
              </p>
            )}
          </div>

          {/* Desktop: the board. */}
          <div className="hidden gap-3 md:grid md:grid-cols-2 lg:grid-cols-4 [&>*]:min-w-0">
            {OPEN_STAGES.map((s) => {
              const items = byStage.get(s)!;
              return (
                <section key={s} aria-label={columnLabel(s, kind)} className="flex flex-col rounded-lg bg-surface-2/60 p-2">
                  <header className="flex items-baseline justify-between gap-2 px-1.5 pb-2 pt-1">
                    <h2 className="truncate text-xs font-medium text-fg">
                      {columnLabel(s, kind)} <span className="ml-1 tabular-nums text-subtle">{items.length}</span>
                    </h2>
                    <span className="shrink-0 text-xs tabular-nums text-subtle">{totalMoney(items)}</span>
                  </header>
                  <div className="flex flex-col gap-2">
                    {items.map((d) => (
                      <DealCard key={d.id} deal={d} today={today} href={openHref(d.id)} showKind={!kind} />
                    ))}
                    {items.length === 0 ? <p className="px-1.5 py-4 text-center text-xs text-subtle">No deals</p> : null}
                  </div>
                </section>
              );
            })}
          </div>

          {/* Closed: always shown on desktop, collapsed on phones. */}
          {won.length || lost.length ? (
            <>
              <section className="mt-10 hidden md:block" aria-label="Closed">
                <ClosedLists kind={kind} won={won} lost={lost} openHref={openHref} timezone={timezone} />
              </section>
              <details className="group mt-8 md:hidden">
                <summary className="mb-2 flex min-h-11 cursor-pointer list-none items-center gap-1 px-4 text-[13px] uppercase tracking-wide text-subtle [&::-webkit-details-marker]:hidden">
                  <ChevronRight className="size-4 transition-transform group-open:rotate-90" strokeWidth={1.75} />
                  Closed
                  <span className="ml-1 normal-case tracking-normal">
                    {won.length} won · {lost.length} lost
                  </span>
                </summary>
                <ClosedLists kind={kind} won={won} lost={lost} openHref={openHref} timezone={timezone} />
              </details>
            </>
          ) : null}
        </>
      )}

      {sheet ? (
        <DealSheet
          deal={sheet.deal}
          contacts={sheet.contacts}
          organizations={sheet.organizations}
          projects={activeProjects}
          prefill={{
            contactId: sheet.prefillContact?.id ?? "",
            organizationId:
              sheet.prefillContact?.organization?.id ??
              (isId(param(sp, "organization")) ? param(sp, "organization") : ""),
            projectId: isId(param(sp, "project")) ? param(sp, "project") : "",
            kind: kind && kind !== "other" ? kind : "booking",
            stage: oneOf(sp, "stage", OPEN_STAGES) || "lead",
          }}
          prefillContactName={sheet.prefillContact?.displayName}
          closeHref={closeHref}
        />
      ) : openId ? (
        <div className="fixed inset-x-4 bottom-24 z-40 md:inset-x-auto md:bottom-6 md:right-6">
          <div className="rounded-lg border border-border bg-surface px-4 py-3 text-sm text-muted shadow-lg">
            That deal no longer exists.{" "}
            <Link href={boardHref} className="text-fg underline underline-offset-2">
              Close
            </Link>
          </div>
        </div>
      ) : null}
    </>
  );
}

function summary(items: Opportunity[], adjective = ""): string {
  const total = totalMoney(items);
  const noun = items.length === 1 ? "deal" : "deals";
  return `${items.length} ${adjective ? `${adjective} ` : ""}${noun}${total ? ` · ${total}` : ""}`;
}

function ProjectSelect({ projects, value, className }: { projects: Project[]; value: string; className?: string }) {
  return (
    <Select name="project" defaultValue={value} aria-label="Project" className={className}>
      <option value="">All projects</option>
      {projects.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </Select>
  );
}

function DealCard({ deal: d, today, href, showKind }: { deal: Opportunity; today: string; href: string; showKind: boolean }) {
  const value = formatMoney(d.value, d.currency);
  const who = [d.contact?.displayName, d.organization?.name].filter(Boolean).join(" · ");
  const next = nextStage(d.stage);
  const overdue = d.followUpAt !== null && d.followUpAt < today;
  const kindLabel = OPPORTUNITY_KINDS.find((k) => k.value === d.kind)?.label;

  return (
    <article className="relative rounded-xl border border-border bg-surface p-3.5 shadow-sm active:bg-surface-2 md:rounded-lg md:p-3 md:shadow-none md:hover:border-border-strong">
      {showKind && kindLabel ? (
        <p className="mb-0.5 text-[11px] font-medium uppercase tracking-wide text-subtle md:text-[10px]">{kindLabel}</p>
      ) : null}
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <Link
            href={href}
            scroll={false}
            className="block text-[15px] font-medium leading-snug text-fg after:absolute after:inset-0 [overflow-wrap:anywhere] md:text-sm"
          >
            {d.title}
          </Link>
          {who ? <p className="mt-0.5 truncate text-[13px] text-muted md:text-xs">{who}</p> : null}
        </div>
        {value ? <span className="shrink-0 text-[15px] font-medium tabular-nums text-fg md:text-sm">{value}</span> : null}
      </div>

      {d.nextStep ? <p className="mt-2 line-clamp-2 text-[13px] text-muted md:text-xs">{d.nextStep}</p> : null}

      <div className="mt-2.5 flex min-w-0 items-center gap-2 text-[13px] md:text-xs">
        {d.project ? (
          <span className="flex min-w-0 items-center gap-1.5 text-muted">
            <ProjectDot color={d.project.color} />
            <span className="truncate">{d.project.name}</span>
          </span>
        ) : null}
        {d.followUpAt ? (
          <span className={cn("shrink-0", overdue ? "font-medium text-danger" : "text-subtle")}>{formatDue(d.followUpAt, today)}</span>
        ) : null}
        {next ? (
          <form action={advanceDeal.bind(null, d.id)} className="relative z-10 ml-auto shrink-0">
            <button
              type="submit"
              title={`Move to ${stageLabel(next, d.kind)}`}
              aria-label={`Move ${d.title} to ${stageLabel(next, d.kind)}`}
              className="-my-1 -mr-1.5 inline-flex h-9 items-center gap-1 rounded-full px-2.5 text-[13px] text-muted active:bg-surface-2 md:h-6 md:rounded-md md:px-1.5 md:text-xs md:hover:bg-surface-2 md:hover:text-fg"
            >
              <span className="md:hidden">{stageLabel(next, d.kind)}</span>
              <ArrowRight className="size-4 md:size-3.5" strokeWidth={1.75} />
            </button>
          </form>
        ) : null}
      </div>
    </article>
  );
}

function ClosedLists({
  kind,
  won,
  lost,
  openHref,
  timezone,
}: {
  kind: KindFilter;
  won: Opportunity[];
  lost: Opportunity[];
  openHref: (id: string) => string;
  timezone: string;
}) {
  const named = kind && kind !== "other";
  return (
    <div className="grid gap-6 md:grid-cols-2 md:gap-4 [&>*]:min-w-0">
      <ClosedList title={named ? stageLabel("won", kind) : "Won"} deals={won} openHref={openHref} timezone={timezone} />
      <ClosedList title={named ? stageLabel("lost", kind) : "Lost"} deals={lost} openHref={openHref} timezone={timezone} />
    </div>
  );
}

function ClosedList({
  title,
  deals,
  openHref,
  timezone,
}: {
  title: string;
  deals: Opportunity[];
  openHref: (id: string) => string;
  timezone: string;
}) {
  return (
    <section aria-label={title}>
      <GroupTitle>
        {title} <span className="ml-1 normal-case tracking-normal">{deals.length}</span>
      </GroupTitle>
      {deals.length ? (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface md:rounded-lg">
          {deals.map((d) => (
            <li key={d.id} className="relative flex min-h-12 items-center gap-3 px-4 py-2 active:bg-surface-2 md:min-h-0 md:hover:bg-surface-2/40">
              <div className="min-w-0 flex-1">
                <Link
                  href={openHref(d.id)}
                  scroll={false}
                  className={cn(
                    "block truncate text-[15px] after:absolute after:inset-0 md:text-sm",
                    d.stage === "lost" ? "text-muted" : "text-fg",
                  )}
                >
                  {d.title}
                </Link>
                <p className="truncate text-[13px] text-subtle md:text-xs">
                  {[d.contact?.displayName ?? d.organization?.name, d.closedAt ? formatDate(d.closedAt, timezone) : null]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <span className="shrink-0 text-[13px] tabular-nums text-muted md:text-xs">{formatMoney(d.value, d.currency)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-4 text-[13px] text-subtle md:px-0 md:text-xs">None yet.</p>
      )}
    </section>
  );
}

function DealSheet({
  deal,
  contacts,
  organizations,
  projects,
  prefill,
  prefillContactName,
  closeHref,
}: {
  deal: Opportunity | null;
  contacts: { id: string; displayName: string }[];
  organizations: { id: string; name: string }[];
  projects: Project[];
  prefill: { contactId: string; organizationId: string; projectId: string; kind: OpportunityKind; stage: OpportunityStage };
  prefillContactName?: string;
  closeHref: string;
}) {
  const kind = deal?.kind ?? prefill.kind;
  const contactId = deal ? (deal.contact?.id ?? "") : prefill.contactId;
  const organizationId = deal ? (deal.organization?.id ?? "") : prefill.organizationId;
  const projectId = deal ? (deal.project?.id ?? "") : prefill.projectId;
  const contactOptions =
    contactId && !contacts.some((c) => c.id === contactId)
      ? [{ id: contactId, displayName: deal?.contact?.displayName ?? prefillContactName ?? "Current contact" }, ...contacts]
      : contacts;
  const orgOptions =
    organizationId && !organizations.some((o) => o.id === organizationId) && deal?.organization
      ? [{ id: deal.organization.id, name: deal.organization.name }, ...organizations]
      : organizations;
  const currency = deal?.currency ?? "USD";
  const title = deal ? "Edit deal" : "New deal";

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={title}>
      <Link href={closeHref} scroll={false} aria-label="Close" className="absolute inset-0 hidden bg-fg/20 md:block" />
      <div className="absolute inset-0 flex flex-col overflow-y-auto overscroll-contain bg-bg md:inset-y-0 md:left-auto md:right-0 md:w-[30rem] md:border-l md:border-border md:bg-surface md:shadow-2xl">
        <header className="sticky top-0 z-10 grid grid-cols-[1fr_auto_1fr] items-center gap-3 border-b border-border bg-bg/90 px-4 pb-2 pt-[calc(env(safe-area-inset-top)+0.5rem)] backdrop-blur-xl md:flex md:justify-between md:bg-surface/90 md:px-5 md:py-3">
          <Link href={closeHref} scroll={false} className="flex h-10 items-center text-[17px] text-fg/80 active:opacity-60 md:hidden">
            Cancel
          </Link>
          <h2 className="truncate text-[17px] font-semibold text-fg md:text-sm">{title}</h2>
          <button
            type="submit"
            form="deal-form"
            className="flex h-10 items-center justify-self-end text-[17px] font-semibold text-fg active:opacity-60 md:hidden"
          >
            {deal ? "Save" : "Add"}
          </button>
          <Link
            href={closeHref}
            scroll={false}
            aria-label="Close"
            className="hidden size-7 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-fg md:inline-flex"
          >
            <X className="size-4" strokeWidth={1.75} />
          </Link>
        </header>

        <div className="flex flex-1 flex-col gap-6 px-4 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] pt-5 md:px-5">
          {deal ? (
            <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted md:text-xs">
              <StageBadge stage={deal.stage} label={stageLabel(deal.stage, deal.kind)} />
              <span>Updated {formatDate(deal.updatedAt, env.timezone)}</span>
              {deal.contact ? (
                <Link href={`/contacts/${deal.contact.id}?tab=deals`} className="text-fg/80 underline-offset-2 hover:underline">
                  {deal.contact.displayName}
                </Link>
              ) : null}
            </div>
          ) : null}

          <ActionForm id="deal-form" action={saveDeal.bind(null, deal?.id ?? null)} className="flex flex-col gap-4">
            <input type="hidden" name="return" value={closeHref} />
            <Field label="Title" htmlFor="deal-title">
              <Input
                id="deal-title"
                name="title"
                required
                defaultValue={deal?.title ?? ""}
                autoFocus={!deal}
                autoComplete="off"
                placeholder="Spring recital at Merkin Hall"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Kind" htmlFor="deal-kind">
                <Select id="deal-kind" name="kind" defaultValue={kind}>
                  {OPPORTUNITY_KINDS.map((k) => (
                    <option key={k.value} value={k.value}>
                      {k.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Stage" htmlFor="deal-stage">
                <Select id="deal-stage" name="stage" defaultValue={deal?.stage ?? prefill.stage}>
                  {OPPORTUNITY_STAGES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {stageLabel(s.value, kind)}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label="Contact" htmlFor="deal-contact">
              <Select id="deal-contact" name="contactId" defaultValue={contactId}>
                <option value="">No contact</option>
                {contactOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.displayName}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Organization" htmlFor="deal-org" hint={deal ? undefined : "Left empty, the contact's organization is used."}>
              <Select id="deal-org" name="organizationId" defaultValue={organizationId}>
                <option value="">No organization</option>
                {orgOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Project" htmlFor="deal-project">
              <Select id="deal-project" name="projectId" defaultValue={projectId}>
                <option value="">No project</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid grid-cols-[minmax(0,1fr)_6.5rem] gap-3">
              <Field label="Value" htmlFor="deal-value">
                <Input
                  id="deal-value"
                  name="value"
                  inputMode="decimal"
                  defaultValue={deal?.value ? String(Number(deal.value)) : ""}
                  placeholder="0"
                  autoComplete="off"
                />
              </Field>
              <Field label="Currency" htmlFor="deal-currency">
                <Select id="deal-currency" name="currency" defaultValue={currency}>
                  {(CURRENCIES.includes(currency) ? CURRENCIES : [currency, ...CURRENCIES]).map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label="Follow-up" htmlFor="deal-follow-up">
              <Input id="deal-follow-up" name="followUpAt" type="date" defaultValue={deal?.followUpAt ?? ""} />
            </Field>
            <Field label="Next step" htmlFor="deal-next">
              <Input id="deal-next" name="nextStep" defaultValue={deal?.nextStep ?? ""} autoComplete="off" placeholder="Send tech rider" />
            </Field>
            <Field label="Notes" htmlFor="deal-notes">
              <Textarea id="deal-notes" name="notes" rows={4} defaultValue={deal?.notes ?? ""} />
            </Field>
            <FormActions className="mt-1">
              <FormSubmit pendingLabel="Saving…">{deal ? "Save" : "Create deal"}</FormSubmit>
              <span className="hidden md:contents">
                <ButtonLink href={closeHref} variant="ghost" scroll={false}>
                  Cancel
                </ButtonLink>
              </span>
            </FormActions>
          </ActionForm>

          {deal ? (
            <div className="border-t border-border pt-4">
              <ConfirmAction
                action={deleteDeal.bind(null, deal.id, closeHref)}
                label="Delete deal"
                confirmLabel="Delete"
                pendingLabel="Deleting…"
              >
                Delete “{deal.title}”? This can&rsquo;t be undone.
              </ConfirmAction>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
