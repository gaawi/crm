import Link from "next/link";
import type { ReactNode } from "react";
import { CONTACT_STATUSES, OPPORTUNITY_STAGES, PROJECT_COLORS } from "@/lib/constants";
import type { ContactStatus, OpportunityStage, ProjectRef } from "@/lib/types";
import { cn } from "@/lib/utils";

export function Badge({ children, className, title }: { children: ReactNode; className?: string; title?: string }) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex h-5 items-center gap-1 whitespace-nowrap rounded px-1.5 text-[11px] font-medium leading-none",
        "bg-surface-2 text-muted",
        className,
      )}
    >
      {children}
    </span>
  );
}

const statusStyles: Record<ContactStatus, string> = {
  new: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  lead: "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  active: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  inactive: "bg-surface-2 text-muted",
  archived: "bg-surface-2 text-subtle",
};

export function StatusBadge({ status }: { status: ContactStatus }) {
  const label = CONTACT_STATUSES.find((s) => s.value === status)?.label ?? status;
  return <Badge className={statusStyles[status]}>{label}</Badge>;
}

const stageStyles: Record<OpportunityStage, string> = {
  lead: "bg-surface-2 text-muted",
  contacted: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  proposal: "bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
  negotiation: "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  won: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  lost: "bg-surface-2 text-subtle",
};

export function StageBadge({ stage }: { stage: OpportunityStage }) {
  const label = OPPORTUNITY_STAGES.find((s) => s.value === stage)?.label ?? stage;
  return <Badge className={stageStyles[stage]}>{label}</Badge>;
}

export function ProjectDot({ color, className }: { color: string; className?: string }) {
  return <span className={cn("inline-block size-2 shrink-0 rounded-full", (PROJECT_COLORS[color] ?? PROJECT_COLORS.gray).dot, className)} />;
}

export function ProjectBadge({ project, link = true }: { project: ProjectRef; link?: boolean }) {
  const inner = (
    <Badge className={(PROJECT_COLORS[project.color] ?? PROJECT_COLORS.gray).badge}>
      <ProjectDot color={project.color} />
      {project.name}
    </Badge>
  );
  return link ? (
    <Link href={`/projects/${project.id}`} className="hover:opacity-80">
      {inner}
    </Link>
  ) : (
    inner
  );
}

export function TagBadge({ tag, href }: { tag: string; href?: string }) {
  const inner = <Badge className="font-normal">#{tag}</Badge>;
  return href ? (
    <Link href={href} className="hover:opacity-80">
      {inner}
    </Link>
  ) : (
    inner
  );
}

/** Small monochrome badge naming the Gmail account a message came from. */
export function AccountBadge({ email }: { email: string }) {
  const [local, domain] = email.split("@");
  return (
    <Badge className="font-normal" title={email}>
      {local}
      <span className="text-subtle">@{domain}</span>
    </Badge>
  );
}
