import Link from "next/link";
import { CalendarClock } from "lucide-react";
import { CampaignPill } from "@/components/campaign-pill";
import { RowList } from "@/components/contact-row";
import { SectionTitle } from "@/components/ui/layout";
import { addDays } from "@/lib/dates";
import type { ScheduledItem } from "@/lib/queries/followups";

const monthTitle = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const dayLabel = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const weekdayLabel = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" });
const utc = (iso: string) => new Date(`${iso}T12:00:00Z`);

/** "This week", then one group per month ("February 2027"). */
function groups(items: ScheduledItem[], today: string): { title: string; items: ScheduledItem[] }[] {
  const weekEnd = addDays(today, 7);
  const out: { title: string; items: ScheduledItem[] }[] = [];
  for (const item of items) {
    const title = item.date <= weekEnd ? "This week" : monthTitle.format(utc(item.date));
    const last = out[out.length - 1];
    if (last?.title === title) last.items.push(item);
    else out.push({ title, items: [item] });
  }
  return out;
}

/**
 * Today → Scheduled: every reminder set for a later day (contacts' follow-ups
 * and campaign rows'), by month, with what to do and the campaign. On its day
 * each one moves up into "Follow up today".
 */
export function ScheduledBlock({ items, today }: { items: ScheduledItem[]; today: string }) {
  if (!items.length) return null;
  return (
    <section aria-label="Scheduled">
      <SectionTitle count={items.length}>Scheduled</SectionTitle>
      <div className="flex flex-col gap-4">
        {groups(items, today).map((group) => (
          <div key={group.title}>
            <h3 className="mb-1.5 flex items-center gap-1.5 px-1 text-[13px] font-semibold text-fg md:text-xs">
              <CalendarClock className="size-3.5 text-brand" aria-hidden />
              {group.title}
              <span className="font-normal text-subtle">{group.items.length}</span>
            </h3>
            <RowList>
              {group.items.map((item) => {
                const href = item.contactId ? `/contacts/${item.contactId}` : `/pipeline?open=${item.opportunityId}`;
                return (
                  <li key={`${item.kind}:${item.id}`} className="flex items-start gap-3 px-4 py-2.5 md:px-3">
                    <span className="flex w-11 shrink-0 flex-col items-center rounded-lg bg-brand/10 py-1 text-brand">
                      <span className="text-[10px] font-semibold uppercase leading-tight">{weekdayLabel.format(utc(item.date))}</span>
                      <span className="text-[13px] font-bold leading-tight">{dayLabel.format(utc(item.date))}</span>
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                        <Link href={href} className="min-w-0 truncate text-[15px] font-medium hover:underline md:text-sm">
                          {item.name}
                        </Link>
                        {item.campaign ? <CampaignPill campaign={item.campaign} /> : null}
                      </div>
                      {item.organization ? <p className="truncate text-[13px] text-muted md:text-xs">{item.organization}</p> : null}
                      {item.note ? <p className="mt-0.5 text-[14px] text-fg/90 md:text-[13px]">{item.note}</p> : null}
                    </div>
                  </li>
                );
              })}
            </RowList>
          </div>
        ))}
      </div>
    </section>
  );
}
