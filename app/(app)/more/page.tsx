import Link from "next/link";
import type { Metadata } from "next";
import { Building2, ChevronRight, FolderKanban, LayoutList, LogOut, Search, Settings, Sparkles, type LucideIcon } from "lucide-react";
import { PageHeader } from "@/components/ui/layout";
import { logout } from "@/app/(auth)/login/actions";

export const metadata: Metadata = { title: "More" };

const GROUPS: { title: string; items: { href: string; label: string; icon: LucideIcon; tint: string }[] }[] = [
  {
    title: "Assistant",
    items: [{ href: "/assistant", label: "Claude", icon: Sparkles, tint: "bg-orange-500" }],
  },
  {
    title: "CRM",
    items: [
      { href: "/organizations", label: "Organizations", icon: Building2, tint: "bg-blue-500" },
      { href: "/projects", label: "Projects", icon: FolderKanban, tint: "bg-violet-500" },
      { href: "/pipeline", label: "Pipeline", icon: LayoutList, tint: "bg-amber-500" },
      { href: "/search", label: "Search", icon: Search, tint: "bg-zinc-500" },
    ],
  },
  {
    title: "App",
    items: [{ href: "/settings", label: "Settings & Gmail accounts", icon: Settings, tint: "bg-zinc-600" }],
  },
];

/** iOS-style grouped list reached from the "More" tab on phones (also works on desktop). */
export default function MorePage() {
  return (
    <>
      <PageHeader title="More" />
      <div className="flex flex-col gap-6">
        {GROUPS.map((group) => (
          <section key={group.title}>
            <h2 className="mb-1.5 px-4 text-[13px] uppercase tracking-wide text-subtle">{group.title}</h2>
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
              {group.items.map(({ href, label, icon: Icon, tint }) => (
                <li key={href}>
                  <Link href={href} className="flex min-h-[52px] items-center gap-3 px-4 active:bg-surface-2">
                    <span className={`flex size-7 items-center justify-center rounded-lg text-white ${tint}`}>
                      <Icon className="size-4" strokeWidth={2} />
                    </span>
                    <span className="flex-1 text-[17px] md:text-sm">{label}</span>
                    <ChevronRight className="size-5 text-subtle" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
        <form action={logout}>
          <button
            type="submit"
            className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-xl border border-border bg-surface text-[17px] text-danger active:bg-surface-2 md:text-sm"
          >
            <LogOut className="size-4" /> Sign out
          </button>
        </form>
      </div>
    </>
  );
}
