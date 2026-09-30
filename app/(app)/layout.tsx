import Link from "next/link";
import { connection } from "next/server";
import { Search } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { MobileNav, SideNav } from "@/components/nav";
import { logout } from "@/app/(auth)/login/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Everything behind the login reads live data: never prerender at build time.
  await connection();
  await requireSession();

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
        <SideNav />
        <form action={logout} className="mt-auto">
          <button type="submit" className="px-2.5 text-xs text-subtle hover:text-muted">
            Sign out
          </button>
        </form>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 border-b border-border bg-surface/95 backdrop-blur md:hidden">
          <div className="flex items-center gap-3 px-4 py-2.5">
            <Link href="/" className="text-sm font-semibold">
              CRM
            </Link>
            <form action="/search" className="flex-1">
              <input
                name="q"
                type="search"
                placeholder="Search"
                className="h-8 w-full rounded-md border border-border bg-bg px-2.5 text-sm placeholder:text-subtle focus:outline-none"
              />
            </form>
          </div>
          <MobileNav />
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
      </div>
    </div>
  );
}
