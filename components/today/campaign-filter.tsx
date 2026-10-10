"use client";

import { useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";
import { ChevronDown } from "lucide-react";
import { TODAY_CAMPAIGN_PARAM, TODAY_CAMPAIGN_STORAGE_KEY, type CampaignOption } from "@/lib/today/campaign-filter";
import { cn } from "@/lib/utils";

function remember(value: string) {
  try {
    window.localStorage.setItem(TODAY_CAMPAIGN_STORAGE_KEY, value);
  } catch {
    // Private mode / blocked storage: the URL still carries the choice.
  }
}

function recall(): string | null {
  try {
    return window.localStorage.getItem(TODAY_CAMPAIGN_STORAGE_KEY);
  } catch {
    return null;
  }
}

const hrefFor = (id: string) => (id ? `/?${TODAY_CAMPAIGN_PARAM}=${encodeURIComponent(id)}` : "/");

/**
 * Today's header → "All campaigns ▾": filter the page to one campaign (each
 * with today's item count). The choice lives in the URL (?campaign=<id>) and
 * is remembered on this device: opening Today without one brings the last
 * campaign back. A native <select> styled as a pill (44pt, 16px on phones).
 */
export function CampaignFilter({ options, selected, total }: { options: CampaignOption[]; selected: string | null; total: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (selected) {
      remember(selected);
      return;
    }
    const stored = recall();
    if (stored && options.some((c) => c.id === stored)) router.replace(hrefFor(stored), { scroll: false });
  }, [selected, options, router]);

  return (
    <label className={cn("relative inline-flex max-w-[11.5rem] items-center md:max-w-[16rem]", pending && "opacity-60")}>
      <span className="sr-only">Filter Today by campaign</span>
      <select
        value={selected ?? ""}
        onChange={(e) => {
          const id = e.target.value;
          remember(id);
          startTransition(() => router.push(hrefFor(id), { scroll: false }));
        }}
        data-testid="today-campaign-filter"
        className={cn(
          "h-11 w-full min-w-0 appearance-none truncate rounded-full border py-0 pl-4 pr-9 text-[16px] font-medium md:h-8 md:pl-3 md:pr-8 md:text-sm",
          selected ? "border-fg bg-fg text-bg" : "border-border bg-surface text-fg",
        )}
      >
        <option value="">All campaigns · {total}</option>
        {options.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name} · {c.count}
          </option>
        ))}
      </select>
      <ChevronDown className={cn("pointer-events-none absolute right-3 size-4 md:right-2.5", selected ? "text-bg/80" : "text-subtle")} aria-hidden />
    </label>
  );
}
