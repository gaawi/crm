import Link from "next/link";
import { AppMailProvider } from "@/components/mail/app-mail-provider";
import { Suspense } from "react";
import { after, connection } from "next/server";
import { Search } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { navCountsForRender } from "@/lib/queries/render-cache";
import { deadlineFor, syncStaleAccounts } from "@/lib/sync/runner";
import { VelaLogo } from "@/components/brand/vela-logo";
import { SendFlourishHost } from "@/components/brand/send-flourish";
import { FeaturesProvider } from "@/components/features";
import { SideNav, TabBar } from "@/components/nav";
import { NavProgress } from "@/components/nav-progress";
import { AppRefresh, RefreshButton } from "@/components/app-refresh";
import { env } from "@/lib/env";
import { sql } from "@/lib/db";
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
  // The frame is sent right away; the badges and the reconnect banner stream in when their counts are ready.

  return (
    <FeaturesProvider claude={env.claudeEnabled}>
      <div className="flex min-h-dvh">
        <aside className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col border-r border-border bg-surface px-3 py-4 md:flex">
          <Link href="/" className="mb-5 flex items-center px-2.5" aria-label="Vela — Today">
            <VelaLogo size={22} wordmarkClassName="text-[15px]" />
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
          <Suspense fallback={<SideNav approvals={0} mail={0} />}>
            <CountedSideNav />
          </Suspense>
          <RefreshButton className="mt-auto mb-2 flex items-center gap-2 px-2.5 text-xs text-subtle hover:text-muted [&_svg]:size-3.5" />
          <form action={logout}>
            <button type="submit" className="px-2.5 text-xs text-subtle hover:text-muted">
              Sign out
            </button>
          </form>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <Suspense fallback={null}>
            <ReauthBanner />
          </Suspense>
          {/* Pages whose root has data-fullbleed (Mail) use the whole width and manage their own padding. */}
          <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-[calc(env(safe-area-inset-bottom)+5.5rem)] pt-[calc(env(safe-area-inset-top)+1rem)] has-[>[data-wide]]:max-w-[100rem] has-[>[data-fullbleed]]:max-w-none has-[>[data-fullbleed]]:p-0 md:px-8 md:py-8">
            <AppMailProvider>{children}</AppMailProvider>
          </main>
        </div>

        <Suspense fallback={<TabBar approvals={0} mail={0} />}>
          <CountedTabBar />
        </Suspense>
        <SendFlourishHost />
        <Suspense fallback={null}>
          <NavProgress />
        </Suspense>
        <AppRefresh version={process.env.VERCEL_GIT_COMMIT_SHA ?? "dev"} />
      </div>
    </FeaturesProvider>
  );
}

async function CountedSideNav() {
  const counts = await navCountsForRender();
  return <SideNav approvals={counts.approvals} mail={counts.mail} />;
}

async function CountedTabBar() {
  const counts = await navCountsForRender();
  return <TabBar approvals={counts.approvals} mail={counts.mail} />;
}

async function ReauthBanner() {
  const [{ accountsNeedingReauth }, paused] = await Promise.all([
    navCountsForRender(),
    // Mailings stopped because their Gmail account must be reconnected (they start again by themselves after).
    sql<{ n: number; queued: number }[]>`
      select count(distinct c.id)::int as n, count(d.id)::int as queued
        from email_campaigns c left join email_drafts d on d.campaign_id = c.id and d.status = 'queued'
       where c.status = 'paused' and c.error like 'Reconnect %'`,
  ]);
  const mailings = paused[0]?.n ?? 0;
  if (accountsNeedingReauth <= 0 && mailings <= 0) return null;
  return (
    <div className="border-b border-red-300 bg-red-50 px-4 pb-2.5 pt-[calc(env(safe-area-inset-top)+0.5rem)] text-[15px] font-medium text-red-900 md:pt-2 md:text-sm dark:border-red-900 dark:bg-red-950 dark:text-red-200">
      {accountsNeedingReauth > 0
        ? `${accountsNeedingReauth === 1 ? "A Gmail account" : `${accountsNeedingReauth} Gmail accounts`} stopped syncing and must be reconnected.`
        : ""}
      {mailings > 0
        ? ` ${mailings === 1 ? "A mass mailing is" : `${mailings} mass mailings are`} paused (${paused[0].queued} emails waiting) until its account is reconnected.`
        : ""}{" "}
      <Link href="/settings" className="underline underline-offset-2">
        Reconnect
      </Link>
    </div>
  );
}
