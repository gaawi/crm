"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { LiveTimeline } from "@/components/booking/activity-timeline";
import { PhoneActions } from "@/components/booking/phone-actions";
import { OrgProfileLine } from "@/components/organizations/profile-card";
import { Sheet } from "@/components/ui/sheet";
import { formatPhone } from "@/lib/booking/phone";
import { isFollowUpDue } from "@/lib/booking/timing";
import type { SheetRow } from "@/lib/booking/types";
import { goalLabel, nextActionLabel, stageLabel } from "@/lib/constants";
import { DateCell, KindCell, NextActionCell, ReturningCell, StageCell, TextCell } from "./cells";
import { PrepareEmailButton, RowBadges, RowPlace, rowSubject, stageOptions, venueName, type EmailSuggestion, type RowContext } from "./row-meta";

/**
 * A row's History: Call / WhatsApp (logged right after the tap), Prepare
 * email, the organization's profile, the row's details, and its timeline (calls, notes, status changes
 * and the emails synced from Gmail). A right-hand panel on desktop, a
 * full-screen sheet on phones. Everything saves by itself.
 */
export function HistoryDrawer({
  row,
  onClose,
  ctx,
  suggestion,
  preparing,
  onPrepare,
}: {
  /** null = closed. */
  row: SheetRow | null;
  onClose: () => void;
  ctx: RowContext;
  suggestion: EmailSuggestion | null;
  preparing: boolean;
  onPrepare: (row: SheetRow) => void;
}) {
  if (!row) return null;
  const c = row.contact;
  const subject = rowSubject(row);
  const status = stageLabel(row.stage, row.kind);
  return (
    <Sheet
      open
      onClose={onClose}
      variant="panel"
      title={venueName(row)}
      description={[c?.displayName, row.kind !== "booking" ? goalLabel(row.kind) : null, status].filter(Boolean).join(" · ")}
      className="md:w-[40rem]"
    >
      <div key={row.id} className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-2">
          <PhoneActions
            phone={c?.phone}
            whatsapp={c?.whatsapp}
            target={{ opportunityId: row.id }}
            timezone={ctx.timezone}
            subject={subject}
            size="button"
            showNumber
          />
          {suggestion ? <PrepareEmailButton suggestion={suggestion} pending={preparing} onPrepare={() => onPrepare(row)} size="button" /> : null}
          <RowBadges row={row} />
        </div>

        {c ? (
          <Link
            href={`/contacts/${c.id}`}
            className="-my-1 flex min-h-11 items-center gap-2 rounded-xl border border-border bg-surface px-4 text-[15px] active:bg-surface-2 md:min-h-0 md:rounded-lg md:px-3 md:py-2 md:text-sm md:hover:bg-surface-2"
          >
            <span className="min-w-0 flex-1 truncate">
              <span className="font-medium text-fg">{c.displayName}</span>
              {c.role ? <span className="text-muted"> · {c.role}</span> : null}
              {c.email ? <span className="block truncate text-[13px] text-subtle md:text-xs">{c.email}</span> : null}
            </span>
            <ChevronRight className="size-4 shrink-0 text-subtle" strokeWidth={2} aria-hidden />
          </Link>
        ) : null}

        {row.organization?.profile ? (
          <OrgProfileLine
            profile={row.organization.profile}
            organization={row.organization}
            className="-my-1"
            editHref={`/organizations/${row.organization.id}?profile=edit`}
          />
        ) : (
          <RowPlace row={row} block className="-my-1 text-[15px] text-muted md:text-sm" />
        )}

        <details className="group rounded-xl border border-border bg-surface md:rounded-lg" open={!c?.phone && !c?.whatsapp}>
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 text-[15px] font-medium active:bg-surface-2 md:min-h-9 md:px-3 md:text-sm [&::-webkit-details-marker]:hidden">
            <span className="flex-1">Details</span>
            <span className="truncate text-[13px] font-normal text-muted md:text-xs">
              {[status, nextActionLabel(row.nextAction), row.section, formatPhone(c?.phone)].filter(Boolean).join(" · ")}
            </span>
            <ChevronRight className="size-4 shrink-0 text-subtle transition-transform group-open:rotate-90" strokeWidth={2} aria-hidden />
          </summary>
          <div className="grid grid-cols-2 gap-x-2 gap-y-3 border-t border-border px-3 pb-4 pt-3">
            <DrawerField label="Status">
              <StageCell rowId={row.id} value={row.stage} options={stageOptions(row.kind)} look="field" />
            </DrawerField>
            <DrawerField label="Goal">
              <KindCell rowId={row.id} value={row.kind} look="field" />
            </DrawerField>
            <DrawerField label="Next step">
              <NextActionCell rowId={row.id} value={row.nextAction} look="field" />
            </DrawerField>
            <DrawerField label="Due">
              <DateCell rowId={row.id} value={row.followUpAt} overdue={isFollowUpDue(row, ctx.today)} look="field" />
            </DrawerField>
            <DrawerField label="Next step detail" wide>
              <TextCell rowId={row.id} name="nextStep" value={row.nextStep} placeholder="Ask for Ana, the season's dates…" label="Next step detail" look="field" />
            </DrawerField>
            <DrawerField label="Phone">
              <TextCell
                rowId={row.id}
                name="phone"
                value={c?.phone ? formatPhone(c.phone) : null}
                placeholder="612 345 678"
                label="Phone"
                type="tel"
                inputMode="tel"
                look="field"
              />
            </DrawerField>
            <DrawerField label="WhatsApp">
              <TextCell
                rowId={row.id}
                name="whatsapp"
                value={c?.whatsapp ? formatPhone(c.whatsapp) : null}
                placeholder="Same as phone"
                label="WhatsApp"
                type="tel"
                inputMode="tel"
                look="field"
              />
            </DrawerField>
            <DrawerField label="Section">
              <TextCell rowId={row.id} name="section" value={row.section} placeholder="No section" label="Section" list={ctx.sectionsListId} look="field" />
            </DrawerField>
            <DrawerField label="Halls / spaces">
              <TextCell rowId={row.id} name="spaces" value={row.spaces} placeholder="Sala principal" label="Halls / spaces" look="field" />
            </DrawerField>
            <ReturningCell rowId={row.id} value={row.returning} className="col-span-2 px-1" />
          </div>
        </details>

        <LiveTimeline source={{ rowId: row.id }} timezone={ctx.timezone} stage={row.stage} kind={row.kind} phone={c?.phone} subject={subject} />
      </div>
    </Sheet>
  );
}

function DrawerField({ label, wide = false, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className={wide ? "col-span-2 flex min-w-0 flex-col gap-1" : "flex min-w-0 flex-col gap-1"}>
      <span className="px-1 text-[13px] text-muted md:text-xs" aria-hidden>
        {label}
      </span>
      {children}
    </div>
  );
}
