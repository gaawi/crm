"use client";

import { memo } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { CallButton, WhatsAppButton } from "@/components/booking/phone-actions";
import { ContactAvatar } from "@/components/contact-avatar";
import { GoalBadge, NextActionIcon } from "@/components/goals";
import { OrgProfileLine } from "@/components/organizations/profile-card";
import { StageBadge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/field";
import { formatPhone } from "@/lib/booking/phone";
import { isFollowUpDue } from "@/lib/booking/timing";
import type { SheetRow } from "@/lib/booking/types";
import { nextActionLabel, stageLabel } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { DateCell, DeleteRowButton, KindCell, NextActionCell, ReturningCell, StageCell, TextCell } from "./cells";
import {
  HistoryButton,
  LastTouchLine,
  PrepareEmailButton,
  RowBadges,
  STAGE_STRIPE,
  stageOptions,
  TimingBadge,
  RowPlace,
  venueName,
  type EmailSuggestion,
  type RowActions,
  type RowContext,
} from "./row-meta";

const label = "px-1 text-[13px] text-muted";

/**
 * Phone card for one venue: who, where things stand (last touch, when to
 * follow up, the next step), big Call / WhatsApp / Email / History tiles,
 * status, follow-up date and next step, and the rest (goal, detail…) behind
 * "Details". Compact cards keep one line of context and small Call /
 * WhatsApp / History buttons.
 */
export const RowCard = memo(function RowCard({
  row,
  ctx,
  actions,
  suggestion,
  preparing,
  compact,
  selectMode,
  selected,
}: {
  row: SheetRow;
  ctx: RowContext;
  actions: RowActions;
  suggestion: EmailSuggestion;
  preparing: boolean;
  compact: boolean;
  selectMode: boolean;
  selected: boolean;
}) {
  const name = venueName(row);
  const c = row.contact;
  const who = c ? [c.displayName, c.role].filter(Boolean).join(" · ") : null;

  const select = selectMode ? (
    <Checkbox
      checked={selected}
      onChange={() => actions.onToggle(row.id)}
      aria-label={`Select ${name}`}
      className="mt-0.5 size-6 shrink-0 cursor-pointer"
    />
  ) : null;

  const title = row.organization ? (
    <Link href={`/organizations/${row.organization.id}`} className="text-[17px] font-semibold leading-snug text-fg [overflow-wrap:anywhere] active:opacity-60">
      {name}
    </Link>
  ) : (
    <span className="text-[17px] font-semibold leading-snug [overflow-wrap:anywhere]">{name}</span>
  );

  if (compact) {
    return (
      <li
        className={cn(
          "flex items-center gap-3 border-l-4 bg-surface py-2.5 pl-3 pr-2",
          STAGE_STRIPE[row.stage],
          selected && "bg-blue-50/70 dark:bg-blue-950/30",
        )}
      >
        {select}
        {c ? <ContactAvatar contact={c} size="sm" /> : null}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-[15px] font-semibold">{name}</span>
            <RowBadges row={row} iconOnly />
          </div>
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
            <StageBadge stage={row.stage} label={stageLabel(row.stage, row.kind)} />
            {row.nextAction ? (
              <span className="flex min-w-0 shrink items-center gap-1 text-[13px] font-medium text-fg/80" title={`Next step: ${nextActionLabel(row.nextAction)}`}>
                <NextActionIcon action={row.nextAction} />
                <span className="truncate">{nextActionLabel(row.nextAction)}</span>
              </span>
            ) : null}
            <RowPlace row={row} className="shrink-[2] text-[13px] text-muted" />
            {c?.displayName ? <span className="min-w-0 truncate text-[13px] text-muted">{c.displayName}</span> : null}
          </div>
          <LastTouchLine row={row} timezone={ctx.timezone} today={ctx.today} className="mt-0.5" />
        </div>
        {selectMode ? null : (
          <div className="flex shrink-0 items-center">
            <CallButton phone={c?.phone} onCall={() => actions.onLog(row, "call")} />
            <WhatsAppButton contact={c} onOpen={() => actions.onLog(row, "whatsapp")} />
            <button
              type="button"
              onClick={() => actions.onHistory(row.id)}
              aria-label={`Open ${name}`}
              className="inline-flex size-10 items-center justify-center rounded-full text-subtle active:bg-surface-2"
            >
              <ChevronRight className="size-5" strokeWidth={2} />
            </button>
          </div>
        )}
      </li>
    );
  }

  return (
    <li
      className={cn(
        "overflow-hidden rounded-2xl border border-l-4 border-border bg-surface",
        STAGE_STRIPE[row.stage],
        selected && "ring-2 ring-blue-500/60",
      )}
    >
      <div className="flex items-start gap-3 px-4 pb-3 pt-3.5">
        {select}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {title}
            {row.kind !== "booking" ? <GoalBadge kind={row.kind} /> : null}
            <RowBadges row={row} />
          </div>
          {row.organization?.profile && !selectMode ? (
            <OrgProfileLine
              profile={row.organization.profile}
              organization={row.organization}
              editHref={`/organizations/${row.organization.id}?profile=edit`}
              className="mt-1"
            />
          ) : (
            <RowPlace row={row} block className="mt-0.5 text-[13px] text-muted" />
          )}
          {row.spaces ? <p className="mt-0.5 truncate text-[13px] text-muted">{row.spaces}</p> : null}

          <div className="mt-2.5">
            {c ? (
              <div className="flex min-w-0 items-center gap-2.5">
                <ContactAvatar contact={c} size="md" />
                <div className="min-w-0 flex-1">
                  <Link href={`/contacts/${c.id}`} className="block truncate text-[15px] text-fg active:opacity-60">
                    {who}
                  </Link>
                  {c.email || c.phone || c.whatsapp ? (
                    <p className="truncate text-[13px] text-subtle">
                      {[c.email, formatPhone(c.phone ?? c.whatsapp) || null].filter(Boolean).join(" · ")}
                    </p>
                  ) : null}
                </div>
              </div>
            ) : (
              <p className="text-[15px] text-subtle">No contact yet</p>
            )}
            <LastTouchLine row={row} timezone={ctx.timezone} today={ctx.today} className="mt-1" />
            <TimingBadge row={row} timezone={ctx.timezone} today={ctx.today} className="mt-1.5 h-6 px-2 text-xs" />
          </div>
        </div>
      </div>

      {selectMode ? null : (
        <div className="grid grid-cols-4 gap-2 px-3">
          <CallButton phone={c?.phone} onCall={() => actions.onLog(row, "call")} size="tile" whenMissing="disabled" />
          <WhatsAppButton contact={c} onOpen={() => actions.onLog(row, "whatsapp")} size="tile" whenMissing="disabled" />
          <PrepareEmailButton suggestion={suggestion} pending={preparing} onPrepare={() => actions.onPrepare(row)} size="tile" />
          <HistoryButton count={row.activityCount} onOpen={() => actions.onHistory(row.id)} size="tile" />
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 px-3 pb-3 pt-3">
        <StageCell rowId={row.id} value={row.stage} options={stageOptions(row.kind)} look="field" />
        <DateCell rowId={row.id} value={row.followUpAt} overdue={isFollowUpDue(row, ctx.today)} look="field" />
        <NextActionCell rowId={row.id} value={row.nextAction} look="field" className="col-span-2" />
      </div>

      <details className="group border-t border-border">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 text-[15px] text-fg active:bg-surface-2 [&::-webkit-details-marker]:hidden">
          <span className="shrink-0 font-medium">Details</span>
          <span className="min-w-0 flex-1 truncate text-[13px] text-muted">
            {[row.nextStep, row.eventDates].filter(Boolean).join(" · ")}
          </span>
          <ChevronRight className="size-4 shrink-0 text-subtle transition-transform group-open:rotate-90" strokeWidth={2} />
        </summary>
        <div className="flex flex-col gap-3 px-3 pb-4 pt-1">
          <CardField label="Next step detail">
            <TextCell rowId={row.id} name="nextStep" value={row.nextStep} placeholder="Ask for Ana, the season's dates…" label="Next step detail" look="field" />
          </CardField>
          <CardField label="Goal">
            <KindCell rowId={row.id} value={row.kind} look="field" />
          </CardField>
          <div className="grid grid-cols-2 gap-2">
            <CardField label="Dates">
              <TextCell rowId={row.id} name="eventDates" value={row.eventDates} placeholder="Spring 2027" label="Dates" look="field" />
            </CardField>
            <CardField label={`Fee (${ctx.currency})`}>
              <TextCell
                rowId={row.id}
                name="fee"
                value={row.value ? String(Number(row.value)) : null}
                placeholder="4500"
                label={`Fee (${ctx.currency})`}
                inputMode="decimal"
                look="field"
              />
            </CardField>
          </div>
          <CardField label="Notes">
            <TextCell rowId={row.id} name="notes" value={row.notes} placeholder="Notes" label="Notes" multiline rows={3} look="field" />
          </CardField>
          <div className="grid grid-cols-2 gap-2">
            <CardField label="Phone">
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
            </CardField>
            <CardField label="WhatsApp">
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
            </CardField>
          </div>
          <CardField label="Section">
            <TextCell rowId={row.id} name="section" value={row.section} placeholder="No section" label="Section" list={ctx.sectionsListId} look="field" />
          </CardField>
          <CardField label="Halls / spaces">
            <TextCell rowId={row.id} name="spaces" value={row.spaces} placeholder="Sala principal" label="Halls / spaces" look="field" />
          </CardField>
          <ReturningCell rowId={row.id} value={row.returning} className="px-1" />
          <div className="px-1">
            <DeleteRowButton rowId={row.id} name={name} label="Remove from campaign" />
          </div>
        </div>
      </details>
    </li>
  );
});

function CardField({ label: text, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className={label} aria-hidden>
        {text}
      </span>
      {children}
    </div>
  );
}
