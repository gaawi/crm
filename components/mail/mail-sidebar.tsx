import Link from "next/link";
import { cn } from "@/lib/utils";
import { ComposeButton } from "./compose-button";
import { MAILBOX_ICONS, type MailboxEntry, type MailboxGroups } from "./mailboxes";

/**
 * Gmail's left column (desktop): Compose, views, accounts, labels. It is an
 * icon rail on narrower screens (md → lg for lists, md → 2xl next to a
 * thread, where the CRM panel needs the room) and full width above.
 */
export function MailSidebar({ groups, variant, account }: { groups: MailboxGroups; variant: "list" | "thread"; account: string | null }) {
  const wide = variant === "list" ? "lg" : "2xl";
  const c = (list: string, thread: string) => (wide === "lg" ? list : thread);
  const label = c("hidden lg:inline", "hidden 2xl:inline");
  return (
    <aside
      aria-label="Mailboxes"
      className={cn(
        "hidden shrink-0 flex-col overflow-y-auto border-r border-border bg-surface py-3 md:flex",
        c("md:w-[4.25rem] lg:w-60", "md:w-[4.25rem] 2xl:w-60"),
      )}
    >
      <div className={cn("mb-3 px-2", c("lg:px-3", "2xl:px-3"))}>
        <ComposeButton account={account} labelClassName={label} className={c("lg:w-auto lg:px-5", "2xl:w-auto 2xl:px-5")} />
      </div>
      <Group entries={groups.views} label={label} wide={wide} />
      {groups.accounts.length > 2 ? (
        <>
          <Heading wide={wide}>Accounts</Heading>
          <Group entries={groups.accounts} label={label} wide={wide} />
        </>
      ) : null}
      {groups.labels.length ? (
        <>
          <Heading wide={wide}>Labels</Heading>
          <Group entries={groups.labels} label={label} wide={wide} />
        </>
      ) : null}
    </aside>
  );
}

function Heading({ children, wide }: { children: React.ReactNode; wide: "lg" | "2xl" }) {
  return (
    <>
      <p className={cn("mb-1 mt-5 hidden px-6 text-[11px] font-medium uppercase tracking-wide text-subtle", wide === "lg" ? "lg:block" : "2xl:block")}>
        {children}
      </p>
      <span className={cn("mx-4 my-3 border-t border-border", wide === "lg" ? "lg:hidden" : "2xl:hidden")} aria-hidden />
    </>
  );
}

function Group({ entries, label, wide }: { entries: MailboxEntry[]; label: string; wide: "lg" | "2xl" }) {
  return (
    <nav className={cn("flex flex-col gap-px px-2", wide === "lg" ? "lg:pr-3" : "2xl:pr-3")}>
      {entries.map((e) => {
        const Icon = MAILBOX_ICONS[e.icon];
        return (
          <Link
            key={e.key}
            href={e.href}
            aria-current={e.active ? "page" : undefined}
            title={e.hint ? `${e.label} — ${e.hint}` : e.label}
            className={cn(
              "relative flex h-8 items-center justify-center gap-3 rounded-full text-sm",
              // The rail shows accounts as dots only; "All inboxes" would repeat Inbox.
              e.key === "all-accounts" && (wide === "lg" ? "max-lg:hidden" : "max-2xl:hidden"),
              wide === "lg" ? "lg:justify-start lg:pl-4 lg:pr-3" : "2xl:justify-start 2xl:pl-4 2xl:pr-3",
              e.active ? "bg-blue-100 font-semibold text-blue-950 dark:bg-blue-950 dark:text-blue-100" : "text-fg/85 hover:bg-surface-2",
            )}
          >
            {e.dot && e.icon === "account" ? (
              <span className={cn("inline-block size-2.5 shrink-0 rounded-full", e.dot)} aria-hidden />
            ) : e.color ? (
              <Icon className="size-4 shrink-0" strokeWidth={1.75} style={{ color: e.color }} />
            ) : (
              <Icon className="size-4 shrink-0" strokeWidth={1.75} />
            )}
            <span className={cn("min-w-0 flex-1 truncate", label)}>{e.label}</span>
            {e.dot && e.icon !== "account" ? <span className={cn("size-2 shrink-0 rounded-full", e.dot, label)} aria-hidden /> : null}
            {e.count ? (
              <>
                <span className={cn("shrink-0 text-xs tabular-nums", e.active ? "font-semibold" : "font-medium text-muted", label)}>{e.count}</span>
                <span
                  className={cn(
                    "absolute right-0.5 top-0 min-w-4 rounded-full bg-blue-600 px-1 text-center text-[10px] font-semibold leading-4 text-white",
                    wide === "lg" ? "lg:hidden" : "2xl:hidden",
                  )}
                >
                  {e.count > 99 ? "99+" : e.count}
                </span>
              </>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
