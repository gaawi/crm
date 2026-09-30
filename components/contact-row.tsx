import Link from "next/link";
import type { ReactNode } from "react";
import { ProjectDot, StatusBadge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/layout";
import { formatDue, formatRelative } from "@/lib/dates";
import type { ContactSummary } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * One contact in a list: avatar, name, organization/role, project dots, and a
 * right-hand meta column (last contact or follow-up). `actions` renders at the
 * far right (small forms/buttons).
 */
export function ContactRow({
  contact,
  timezone,
  today,
  meta = "last_contacted",
  showStatus = false,
  actions,
  note,
}: {
  contact: ContactSummary;
  timezone: string;
  today: string;
  meta?: "last_contacted" | "follow_up" | "last_inbound" | "last_outbound";
  showStatus?: boolean;
  actions?: ReactNode;
  note?: ReactNode;
}) {
  const subtitle =
    [contact.role, contact.organization?.name].filter(Boolean).join(" · ") ||
    (contact.primaryEmail !== contact.displayName ? contact.primaryEmail : null) ||
    (contact.status === "new" ? "New from email — add details" : " ");
  let metaText: ReactNode = null;
  if (meta === "follow_up" && contact.followUpAt) {
    const overdue = contact.followUpAt < today;
    metaText = <span className={cn(overdue && "text-danger")}>{formatDue(contact.followUpAt, today)}</span>;
  } else if (meta === "last_inbound") {
    metaText = `wrote ${formatRelative(contact.lastInboundAt, timezone)}`;
  } else if (meta === "last_outbound") {
    metaText = `you wrote ${formatRelative(contact.lastOutboundAt, timezone)}`;
  } else {
    metaText = contact.lastContactedAt ? formatRelative(contact.lastContactedAt, timezone) : "no email yet";
  }

  return (
    <li className="group flex items-center gap-3 px-4 py-2.5">
      <Avatar name={contact.displayName} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Link href={`/contacts/${contact.id}`} className="truncate text-sm font-medium text-fg hover:underline">
            {contact.displayName}
          </Link>
          {showStatus ? <StatusBadge status={contact.status} /> : null}
          {contact.projects.length ? (
            <span className="flex items-center gap-1" title={contact.projects.map((p) => p.name).join(", ")}>
              {contact.projects.slice(0, 4).map((p) => (
                <ProjectDot key={p.id} color={p.color} />
              ))}
            </span>
          ) : null}
        </div>
        <p className="truncate text-xs text-muted">{note ?? subtitle}</p>
      </div>
      <span className="hidden shrink-0 text-xs text-subtle sm:block">{metaText}</span>
      {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
    </li>
  );
}

/** Bordered list container for ContactRow / other rows. */
export function RowList({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <ul className={cn("divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface", className)}>
      {children}
    </ul>
  );
}
