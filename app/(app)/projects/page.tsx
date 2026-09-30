import Link from "next/link";
import type { Metadata } from "next";
import { ChevronRight } from "lucide-react";
import { ProjectDot } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/layout";
import { listProjects } from "@/lib/queries/projects";
import type { Project } from "@/lib/types";
import { ActionForm, FormSubmit } from "../_components/action-form";
import { FormActions, GroupTitle, HeaderAddButton } from "../_components/ui";
import { param } from "../_lib/url";
import { createProjectAction } from "./actions";
import { ProjectFields } from "./project-fields";

export const metadata: Metadata = { title: "Projects" };

export default async function ProjectsPage({ searchParams }: PageProps<"/projects">) {
  const sp = await searchParams;
  const creating = param(sp, "new") === "1";
  const projects = await listProjects({ includeArchived: true });
  const active = projects.filter((p) => !p.archived);
  const archived = projects.filter((p) => p.archived);

  return (
    <>
      <PageHeader title="Projects" actions={<HeaderAddButton href="/projects?new=1" label="New project" />} />

      {creating ? (
        <section className="mb-8" aria-label="New project">
          <GroupTitle>New project</GroupTitle>
          <ActionForm action={createProjectAction} className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4 md:rounded-lg">
            <ProjectFields autoFocus />
            <FormActions>
              <FormSubmit pendingLabel="Creating…">Create project</FormSubmit>
              <ButtonLink href="/projects" variant="ghost">
                Cancel
              </ButtonLink>
            </FormActions>
          </ActionForm>
        </section>
      ) : null}

      {active.length ? (
        <ProjectList projects={active} />
      ) : (
        <EmptyState title="No projects" action={<ButtonLink href="/projects?new=1" variant="primary">New project</ButtonLink>}>
          Projects group the people and deals of one production, season or cause.
        </EmptyState>
      )}

      {archived.length ? (
        <details className="group mt-8">
          <summary className="mb-2 flex min-h-11 cursor-pointer list-none items-center gap-1 px-4 text-[13px] uppercase tracking-wide text-subtle md:min-h-0 md:px-0 md:text-xs md:font-medium [&::-webkit-details-marker]:hidden">
            <ChevronRight className="size-4 transition-transform group-open:rotate-90 md:size-3.5" strokeWidth={1.75} />
            Archived <span className="ml-1 normal-case tracking-normal">{archived.length}</span>
          </summary>
          <ProjectList projects={archived} />
        </details>
      ) : null}
    </>
  );
}

function ProjectList({ projects }: { projects: Project[] }) {
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface md:rounded-lg">
      {projects.map((p) => {
        const counts = [
          `${p.contactCount} ${p.contactCount === 1 ? "person" : "people"}`,
          p.openOpportunityCount ? `${p.openOpportunityCount} open ${p.openOpportunityCount === 1 ? "deal" : "deals"}` : null,
        ].filter(Boolean);
        return (
          <li key={p.id} className="relative flex min-h-[60px] items-center gap-3 px-4 py-2.5 active:bg-surface-2 md:min-h-0 md:hover:bg-surface-2/40">
            <ProjectDot color={p.color} className="size-2.5" />
            <div className="min-w-0 flex-1">
              <Link
                href={`/projects/${p.id}`}
                className="block truncate text-[15px] font-medium text-fg after:absolute after:inset-0 md:text-sm md:hover:underline"
              >
                {p.name}
              </Link>
              <p className="truncate text-[13px] text-muted md:text-xs">
                <span className="md:hidden">{counts.join(" · ")}</span>
                <span className="hidden md:inline">{p.description || counts.join(" · ")}</span>
              </p>
            </div>
            <span className="hidden w-24 shrink-0 text-right text-xs tabular-nums text-muted md:block">
              {p.contactCount} {p.contactCount === 1 ? "person" : "people"}
            </span>
            <span className="hidden w-28 shrink-0 text-right text-xs tabular-nums text-muted md:block">
              {p.openOpportunityCount ? `${p.openOpportunityCount} open ${p.openOpportunityCount === 1 ? "deal" : "deals"}` : "—"}
            </span>
            <ChevronRight className="size-5 shrink-0 text-subtle md:hidden" strokeWidth={1.75} />
          </li>
        );
      })}
    </ul>
  );
}
