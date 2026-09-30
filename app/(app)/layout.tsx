import Link from "next/link";
import { after, connection } from "next/server";
import { Search } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { getMailCounts } from "@/lib/mail/queries";
import { countPendingDrafts } from "@/lib/queries/drafts";
import { getOverviewCounts } from "@/lib/queries/stats";
import { deadlineFor, syncStaleAccounts } from "@/lib/sync/runner";
import { SideNav, TabBar } from "@/components/nav";
import { logout } from "@/app/(auth)/login/actions";

/** Also the limit for server actions (Claude drafting, import chunks) and the sync-on-visit below. */
export const maxDuration = 300;

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Everything behind the login reads live data: never prerender at build time.
  await connection();
  await requireSession();
  // Sync-on-visit: mailboxes not synced in the last 10 minutes catch up after
  // the page is sent (covers missed push notifications; never throws). The
  // deadline keeps a safety margin for the time the render already took.
  after(() => syncStaleAccounts({ deadline: deadlineFor(maxDuration) - 15_000 }));
  const [approvals, counts, mail] = await Promise.all([countPendingDrafts(), getOverviewCounts(), getMailCounts()]);

  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col border-r border-border bg-surface px-3 py-4 md:flex">
        <Link href="/" className="mb-5 flex items-center gap-2 px-2.5 text-sm font-semibold tracking-tight">
          <span className="inline-block size-5 rounded-md bg-accent" aria-hidden />
          CRM
        </Link>
        <form action="/search" className="relative mb-4">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-subtle" />
          <input
            name="q"
            type="search"
            placeholder="Search"
            aria-label="Search contacts, organizations and emails"
            className="h-8 w-full rounded-md border border-border bg-bg pl-8 pr-2 text-sm placeholder:text-subtle focus:border-border-strong focus:outline-none"
          />
        </form>
        <SideNav approvals={approvals} mail={mail.inbox.primary} />
        <form action={logout} className="mt-auto">
          <button type="submit" className="px-2.5 text-xs text-subtle hover:text-muted">
            Sign out
          </button>
        </form>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {counts.accountsNeedingReauth > 0 ? (
          <div className="border-b border-amber-200 bg-amber-50 px-4 pb-2 pt-[calc(env(safe-area-inset-top)+0.5rem)] text-sm text-amber-900 md:pt-2 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
            {counts.accountsNeedingReauth === 1 ? "A Gmail account" : `${counts.accountsNeedingReauth} Gmail accounts`} stopped syncing and
            must be reconnected.{" "}
            <Link href="/settings" className="font-medium underline underline-offset-2">
              Reconnect
            </Link>
          </div>
        ) : null}
        {/* Pages whose root has data-fullbleed (Mail) use the whole width and manage their own padding. */}
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-[calc(env(safe-area-inset-bottom)+5.5rem)] pt-[calc(env(safe-area-inset-top)+1rem)] has-[>[data-fullbleed]]:max-w-none has-[>[data-fullbleed]]:p-0 md:px-8 md:py-8">
          {children}
        </main>
      </div>

      <TabBar approvals={approvals} mail={mail.inbox.primary} />
    </div>
  );
}
