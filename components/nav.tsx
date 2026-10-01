"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Building2,
  CalendarCheck,
  FolderKanban,
  Inbox,
  LayoutList,
  Mail,
  Menu,
  Send,
  Settings,
  Sparkles,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useClaudeEnabled } from "@/components/features";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Today", icon: CalendarCheck },
  { href: "/mail", label: "Mail", icon: Mail },
  { href: "/approvals", label: "Approvals", icon: Send },
  { href: "/contacts", label: "Contacts", icon: Users },
  { href: "/organizations", label: "Organizations", icon: Building2 },
  { href: "/projects", label: "Projects", icon: FolderKanban },
  { href: "/pipeline", label: "Pipeline", icon: LayoutList },
  { href: "/assistant", label: "Claude", icon: Sparkles },
  { href: "/settings", label: "Settings", icon: Settings },
];

/** iPhone tab bar: the four most used sections + More (Claude lives in More and on Today). */
const TAB_ITEMS: NavItem[] = [
  { href: "/", label: "Today", icon: CalendarCheck },
  { href: "/mail", label: "Mail", icon: Mail },
  { href: "/approvals", label: "Approvals", icon: Inbox },
  { href: "/contacts", label: "Contacts", icon: Users },
  { href: "/more", label: "More", icon: Menu },
];

/** Routes reached through "More" keep the More tab highlighted. */
const MORE_ROUTES = ["/more", "/organizations", "/projects", "/pipeline", "/settings", "/search", "/assistant"];

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  if (href === "/more") return MORE_ROUTES.some((r) => pathname === r || pathname.startsWith(`${r}/`));
  return pathname === href || pathname.startsWith(`${href}/`);
}

function Count({ value }: { value?: number }) {
  if (!value) return null;
  return (
    <span className="ml-auto min-w-5 rounded-full bg-accent px-1.5 text-center text-[11px] font-semibold leading-5 text-accent-fg">
      {value > 99 ? "99+" : value}
    </span>
  );
}

export function SideNav({ approvals = 0, mail = 0 }: { approvals?: number; mail?: number }) {
  const pathname = usePathname();
  const claude = useClaudeEnabled();
  return (
    <nav className="flex flex-col gap-0.5">
      {NAV_ITEMS.filter((item) => claude || item.href !== "/assistant").map(({ href, label, icon: Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex h-8 items-center gap-2.5 rounded-md px-2.5 text-sm transition-colors",
              active ? "bg-surface-2 font-medium text-fg" : "text-muted hover:bg-surface-2 hover:text-fg",
            )}
          >
            <Icon className="size-4 shrink-0" strokeWidth={1.75} />
            {label}
            {href === "/approvals" ? <Count value={approvals} /> : href === "/mail" ? <Count value={mail} /> : null}
          </Link>
        );
      })}
    </nav>
  );
}

function TabBadge({ value }: { value: number }) {
  if (!value) return null;
  return (
    <span className="absolute left-1/2 top-1 ml-2 min-w-[18px] rounded-full bg-danger px-1 text-center text-[11px] font-semibold leading-[18px] text-white">
      {value > 99 ? "99+" : value}
    </span>
  );
}

/** Fixed bottom tab bar for phones (safe-area aware, 49pt like iOS). */
export function TabBar({ approvals = 0, mail = 0 }: { approvals?: number; mail?: number }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden"
    >
      <ul className="grid h-[52px] grid-cols-5">
        {TAB_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex h-full flex-col items-center justify-center gap-0.5 text-[10px] font-medium",
                  active ? "text-fg" : "text-subtle",
                )}
              >
                <Icon className="size-6" strokeWidth={active ? 2.1 : 1.6} />
                {label}
                <TabBadge value={href === "/approvals" ? approvals : href === "/mail" ? mail : 0} />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
