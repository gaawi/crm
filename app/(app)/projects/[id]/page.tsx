import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache, type ReactNode } from "react";
import { Archive, ArchiveRestore, Ellipsis, Pencil, Plus, Trash2, X } from "lucide-react";
import { ContactRow, RowList } from "@/components/contact-row";
import { Badge, ProjectDot } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Avatar } from "@/components/ui/layout";
import { SubmitButton } from "@/components/ui/submit-button";
import { formatDate, todayIn } from "@/lib/dates";
import { env } from "@/lib/env";
import { listContacts } from "@/lib/queries/contacts";
import { searchMessages } from "@/lib/queries/messages";
import { listOpportunities } from "@/lib/queries/opportunities";
import { getProject } from "@/lib/queries/projects";
import type { ContactRef, ContactSummary } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ActionForm, FormSubmit } from "../../_components/action-form";
import { DealRow } from "../../_components/deal-row";
import { Dropdown } from "../../_components/dropdown";
import { FilterForm } from "../../_components/filter-form";
import { Segmented } from "../../_components/segmented";
import { BackLink, FormActions, GroupAction, GroupTitle, SearchInput, iconButtonClass, menuItemClass } from "../../_components/ui";
import { hrefWith, oneOf, param } from "../../_lib/url";
import {
  addProjectMember,
  deleteProjectAction,
  removeProjectMember,
  setProjectArchived,
  updateProjectAction,
} from "../actions";
import { ProjectFields } from "../project-fields";

const TABS = ["people", "add", "deals"] as const;
type Tab = (typeof TABS)[number];

const loadProject = cache(getProject);

export async function generateMetadata({ params }: PageProps<"/projects/[id]">): Promise<Metadata> {
  const project = await loadProject((await params).id);
  return { title: project?.name ?? "Project" };
}

interface Mention {
  contact: ContactRef;
  subject: string | null;
  sentAt: Date;
}

export default async function ProjectPage({ params, searchParams }: PageProps<"/projects/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const project = await loadProject(id);
  if (!project) notFound();

  const timezone = env.timezone;
  const today = todayIn(timezone);
  const base = `/projects/${project.id}`;
  const tab: Tab = oneOf(sp, "tab", TABS) || "people";
  const add = param(sp, "add");
  const editing = param(sp, "edit") === "1";

  if (param(sp, "delete") === "1") {
    return (
      <div className="mx-auto max-w-2xl">
        <header className="mb-5 flex flex-col gap-3">
          <BackLink href={base} label={project.name} />
          <h1 className="text-[28px] font-bold leading-tight tracking-tight md:text-xl md:font-semibold">Delete project</h1>
        </header>
        <div className="flex flex-col gap-5">
          <div className="rounded-xl border border-border bg-surface p-4 md:rounded-lg">
            <p className="text-[15px] font-medium text-fg md:text-sm">Delete {project.name}?</p>
            <p className="mt-2 text-[15px] text-muted md:text-sm">
              People and deals are kept; they just stop belonging to this project. To keep it for the record, archive it
              instead.
            </p>
          </div>
          <FormActions>
            <form action={deleteProjectAction.bind(null, project.id)} className="contents">
              <SubmitButton variant="danger" pendingLabel="Deleting…">
                Delete project
              </SubmitButton>
            </form>
            {!project.archived ? (
              <form action={setProjectArchived.bind(null, project.id, true)} className="contents">
                <SubmitButton variant="secondary">Archive instead</SubmitButton>
              </form>
            ) : null}
            <ButtonLink href={base} variant="ghost">
              Cancel
            </ButtonLink>
          </FormActions>
        </div>
      </div>
    );
  }

  const [{ contacts: members }, searchResults, hits, deals] = await Promise.all([
    listContacts({ projectId: project.id, limit: 500 }),
    add ? listContacts({ q: add, limit: 25 }) : null,
    searchMessages({ q: project.name, limit: 50 }),
    listOpportunities({ projectId: project.id, includeClosed: true }),
  ]);

  const memberIds = new Set(members.map((m) => m.id));
  const candidates = (searchResults?.contacts ?? []).filter((c) => !memberIds.has(c.id)).slice(0, 15);
  const mentions: Mention[] = [];
  const seen = new Set<string>();
  for (const hit of hits) {
    for (const contact of hit.contacts) {
      if (memberIds.has(contact.id) || seen.has(contact.id)) continue;
      seen.add(contact.id);
      mentions.push({ contact, subject: hit.subject, sentAt: hit.sentAt });
    }
  }
  const openDeals = deals.filter((d) => d.stage !== "won" && d.stage !== "lost");
  const show = (t: Tab) => (tab === t ? "flex" : "hidden md:flex");
  const addDealHref = hrefWith("/pipeline", { new: 1, project: project.id, return: `${base}?tab=deals` });

  return (
    <>
      <header className="mb-6 flex flex-col gap-3">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <BackLink href="/projects" label="Projects" />
          <Dropdown label="More actions" trigger={<Ellipsis className="size-5" strokeWidth={1.75} />}>
            <Link href={`${base}?edit=1`} className={menuItemClass}>
              <Pencil className="size-4 text-muted" strokeWidth={1.75} />
              Edit
            </Link>
            <form action={setProjectArchived.bind(null, project.id, !project.archived)}>
              <button type="submit" className={menuItemClass}>
                {project.archived ? (
                  <ArchiveRestore className="size-4 text-muted" strokeWidth={1.75} />
                ) : (
                  <Archive className="size-4 text-muted" strokeWidth={1.75} />
                )}
                {project.archived ? "Unarchive" : "Archive"}
              </button>
            </form>
            <Link href={`${base}?delete=1`} className={cn(menuItemClass, "text-danger")}>
              <Trash2 className="size-4" strokeWidth={1.75} />
              Delete…
            </Link>
          </Dropdown>
        </div>
        <div className="min-w-0">
          <h1 className="flex min-w-0 items-center gap-2.5 text-[28px] font-bold leading-tight tracking-tight text-fg md:text-xl md:font-semibold">
            <ProjectDot color={project.color} className="size-3 md:size-2.5" />
            <span className="min-w-0 [overflow-wrap:anywhere]">{project.name}</span>
            {project.archived ? <Badge>Archived</Badge> : null}
          </h1>
          <p className="mt-1 text-[15px] text-muted md:text-sm">
            {project.description ? <span className="prose-plain">{project.description}</span> : null}
            {project.description ? <span className="text-subtle"> · </span> : null}
            <span className="text-subtle">
              {project.contactCount} {project.contactCount === 1 ? "person" : "people"}
              {project.openOpportunityCount ? ` · ${project.openOpportunityCount} open ${project.openOpportunityCount === 1 ? "deal" : "deals"}` : ""}
            </span>
          </p>
        </div>
      </header>

      {editing ? (
        <section className="mb-8 max-w-xl" aria-label="Edit project">
          <GroupTitle>Edit project</GroupTitle>
          <ActionForm
            action={updateProjectAction.bind(null, project.id)}
            className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4 md:rounded-lg"
          >
            <ProjectFields name={project.name} color={project.color} description={project.description ?? ""} />
            <FormActions>
              <FormSubmit pendingLabel="Saving…">Save</FormSubmit>
              <ButtonLink href={base} variant="ghost">
                Cancel
              </ButtonLink>
            </FormActions>
          </ActionForm>
        </section>
      ) : null}

      <Segmented
        label="Sections"
        className="mb-5 md:hidden"
        segments={[
          { href: base, label: "People", active: tab === "people", count: members.length },
          { href: `${base}?tab=add`, label: "Add people", active: tab === "add", count: mentions.length },
          { href: `${base}?tab=deals`, label: "Deals", active: tab === "deals", count: openDeals.length },
        ]}
      />

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem] xl:grid-cols-[minmax(0,1fr)_24rem] [&>*]:min-w-0">
        <section className={cn("flex-col", show("people"))} aria-label="People in the project">
          <GroupTitle>
            People <span className="ml-1 normal-case tracking-normal">{members.length}</span>
          </GroupTitle>
          {members.length ? (
            <RowList>
              {members.map((c) => (
                <ContactRow
                  key={c.id}
                  contact={c}
                  timezone={timezone}
                  today={today}
                  actions={
                    <form action={removeProjectMember.bind(null, project.id, c.id)}>
                      <button
                        type="submit"
                        aria-label={`Remove ${c.displayName} from ${project.name}`}
                        title="Remove from project"
                        className={iconButtonClass}
                      >
                        <X className="size-[18px] md:size-3.5" strokeWidth={1.75} />
                      </button>
                    </form>
                  }
                />
              ))}
            </RowList>
          ) : (
            <Empty>Nobody yet. Add people from your contacts or from the emails that mention {project.name}.</Empty>
          )}
        </section>

        <div className="flex flex-col gap-8 md:gap-7">
          <section className={cn("flex-col", show("add"))} aria-label="Add people">
            <GroupTitle className="hidden md:flex">Add people</GroupTitle>
            <FilterForm action={base} scroll={false} role="search" aria-label="Find contacts to add" className="mb-3">
              <input type="hidden" name="tab" value="add" />
              <SearchInput name="add" defaultValue={add} placeholder="Search contacts to add" aria-label="Search contacts" />
            </FilterForm>
            {add ? (
              candidates.length ? (
                <RowList>
                  {candidates.map((c) => (
                    <CandidateRow key={c.id} contact={c} action={addProjectMember.bind(null, project.id, c.id)} />
                  ))}
                </RowList>
              ) : (
                <p className="px-4 text-[15px] text-muted md:px-0 md:text-sm">
                  {searchResults?.contacts.length ? "Everyone matching is already in the project." : `No contacts match “${add}”.`}
                </p>
              )
            ) : null}
          </section>

          <section className={cn("flex-col", show("add"))} aria-label="Mentioned this project in email">
            <GroupTitle>Mentioned {project.name} in email</GroupTitle>
            {mentions.length ? (
              <RowList>
                {mentions.slice(0, 20).map((m) => (
                  <li key={m.contact.id} className="flex min-h-[60px] items-center gap-3 px-4 py-2.5 md:min-h-0">
                    <Avatar name={m.contact.displayName} />
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/contacts/${m.contact.id}`}
                        className="block truncate text-[15px] font-medium text-fg hover:underline md:text-sm"
                      >
                        {m.contact.displayName}
                      </Link>
                      <p className="truncate text-[13px] text-muted md:text-xs">
                        {m.subject || "(no subject)"} · {formatDate(m.sentAt, timezone)}
                      </p>
                    </div>
                    <AddButton action={addProjectMember.bind(null, project.id, m.contact.id)} label={`Add ${m.contact.displayName}`} />
                  </li>
                ))}
              </RowList>
            ) : (
              <Empty>No one outside the project has mentioned “{project.name}” in email.</Empty>
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
                No deals in this project.{" "}
                <Link href={addDealHref} className="text-fg underline-offset-2 hover:underline">
                  Add one
                </Link>
              </Empty>
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

function AddButton({ action, label }: { action: () => Promise<void>; label: string }) {
  return (
    <form action={action}>
      <SubmitButton variant="secondary" size="sm" aria-label={label} className="shrink-0">
        <Plus className="size-4 md:size-3.5" strokeWidth={1.75} />
        Add
      </SubmitButton>
    </form>
  );
}

function CandidateRow({ contact: c, action }: { contact: ContactSummary; action: () => Promise<void> }) {
  const subtitle = [c.role, c.organization?.name].filter(Boolean).join(" · ") || c.primaryEmail || "";
  return (
    <li className="flex min-h-[60px] items-center gap-3 px-4 py-2.5 md:min-h-0">
      <Avatar name={c.displayName} />
      <div className="min-w-0 flex-1">
        <Link href={`/contacts/${c.id}`} className="block truncate text-[15px] font-medium text-fg hover:underline md:text-sm">
          {c.displayName}
        </Link>
        {subtitle ? <p className="truncate text-[13px] text-muted md:text-xs">{subtitle}</p> : null}
      </div>
      <AddButton action={action} label={`Add ${c.displayName}`} />
    </li>
  );
}
