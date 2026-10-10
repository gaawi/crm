"use client";

import { memo } from "react";
import Link from "next/link";
import { Phone } from "lucide-react";
import { WhatsAppButton } from "@/components/booking/phone-actions";
import { ContactAvatar } from "@/components/contact-avatar";
import { OrgProfileIconButton } from "@/components/organizations/profile-card";
import { Checkbox } from "@/components/ui/field";
import { formatPhone, telHref } from "@/lib/booking/phone";
import { isFollowUpDue, isOpenStage } from "@/lib/booking/timing";
import type { SheetRow } from "@/lib/booking/types";
import { cn } from "@/lib/utils";
import { DateCell, DeleteRowButton, KindCell, NextActionCell, StageCell, TextCell } from "./cells";
import {
  RowPlace,
  HistoryButton,
  LastTouchLine,
  PrepareEmailButton,
  RowBadges,
  STAGE_STRIPE,
  stageOptions,
  TimingBadge,
  venueName,
  type EmailSuggestion,
  type RowActions,
  type RowContext,
} from "./row-meta";

export interface RowGroup {
  /** null = rows without a section ("Other"). */
  section: string | null;
  rows: SheetRow[];
}

/**
 * Desktop sheet: fixed column widths that fit a 1280px window without
 * horizontal scrolling (the frame scrolls by itself on narrower windows).
 * Sections become header rows; the checkboxes feed the bulk bar.
 */
export function RowsTable({
  groups,
  showSectionHeaders,
  ctx,
  actions,
  selected,
  onSelectMany,
  suggestions,
  preparing,
}: {
  groups: RowGroup[];
  showSectionHeaders: boolean;
  ctx: RowContext;
  actions: RowActions;
  selected: ReadonlySet<string>;
  onSelectMany: (rowIds: string[], on: boolean) => void;
  suggestions: ReadonlyMap<string, EmailSuggestion>;
  preparing: ReadonlySet<string>;
}) {
  const allIds = groups.flatMap((g) => g.rows.map((r) => r.id));
  const allOn = allIds.length > 0 && allIds.every((id) => selected.has(id));
  const someOn = !allOn && allIds.some((id) => selected.has(id));

  return (
    <div className="hidden overflow-x-auto rounded-lg border border-border bg-surface md:block">
      <table className="w-full min-w-[60rem] table-fixed border-collapse text-sm">
        {/* 876px fixed + notes: fits the 992px a 1280px window leaves (sidebar and padding). */}
        <colgroup>
          <col className="w-8" />
          <col className="w-[9rem]" />
          <col className="w-[11rem]" />
          <col className="w-[9.25rem]" />
          <col className="w-[9.5rem]" />
          <col className="w-[6.5rem]" />
          <col />
          <col className="w-[7.5rem]" />
        </colgroup>
        <thead>
          <tr className="border-b border-border text-left text-xs font-medium text-subtle">
            <th className="border-l-[3px] border-l-transparent py-2 pl-2.5 pr-0 font-medium">
              <SelectBox
                checked={allOn}
                indeterminate={someOn}
                label={allOn ? "Unselect all" : "Select all shown"}
                onChange={(on) => onSelectMany(allIds, on)}
              />
            </th>
            <th className="px-3 py-2 font-medium">Organization</th>
            <th className="px-3 py-2 font-medium">Contact · last touch</th>
            <th className="px-1 py-2 font-medium">Status · goal</th>
            <th className="px-1 py-2 font-medium">Next step · due</th>
            <th className="whitespace-nowrap px-1 py-2 font-medium" title={`Fee in ${ctx.currency}`}>
              Dates · fee <span className="font-normal">{ctx.currency}</span>
            </th>
            <th className="px-1 py-2 font-medium">Notes</th>
            <th className="px-2 py-2 font-medium">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        {groups.map((group) => {
          const ids = group.rows.map((r) => r.id);
          const groupOn = ids.length > 0 && ids.every((id) => selected.has(id));
          return (
            <tbody key={group.section ?? "\u0000other"} className="divide-y divide-border border-b border-border last:border-b-0">
              {showSectionHeaders ? (
                <tr className="bg-surface-2/70">
                  <th className="border-l-[3px] border-l-transparent py-1.5 pl-2.5 pr-0">
                    <SelectBox
                      checked={groupOn}
                      indeterminate={!groupOn && ids.some((id) => selected.has(id))}
                      label={`Select ${group.section ?? "rows without a section"}`}
                      onChange={(on) => onSelectMany(ids, on)}
                    />
                  </th>
                  <th colSpan={7} scope="colgroup" className="px-3 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-muted">
                    {group.section ?? "Other"} <span className="ml-1 font-medium text-subtle tabular-nums">{group.rows.length}</span>
                  </th>
                </tr>
              ) : null}
              {group.rows.map((row) => (
                <TableRow
                  key={row.id}
                  row={row}
                  ctx={ctx}
                  actions={actions}
                  selected={selected.has(row.id)}
                  suggestion={suggestions.get(row.id)!}
                  preparing={preparing.has(row.id)}
                />
              ))}
            </tbody>
          );
        })}
      </table>
    </div>
  );
}

function SelectBox({
  checked,
  indeterminate = false,
  label,
  onChange,
}: {
  checked: boolean;
  indeterminate?: boolean;
  label: string;
  onChange: (on: boolean) => void;
}) {
  return (
    <Checkbox
      checked={checked}
      ref={(el) => {
        if (el) el.indeterminate = indeterminate;
      }}
      aria-label={label}
      title={label}
      onChange={(e) => onChange(e.currentTarget.checked)}
      className="cursor-pointer align-middle"
    />
  );
}

/**
 * The number itself is the Call button (☎ +34 612 345 678): the column is too
 * narrow for number + Call + WhatsApp. Like <CallButton>, the href comes from
 * telHref only, and the log dialog opens right after the tap.
 */
function CallLink({ phone, onCall }: { phone: string; onCall: () => void }) {
  const href = telHref(phone)!;
  const number = formatPhone(href.slice("tel:".length));
  return (
    <a
      href={href}
      onClick={() => window.setTimeout(onCall, 150)}
      title={`Call ${number}`}
      aria-label={`Call ${number}`}
      className="inline-flex h-7 min-w-0 items-center gap-1 rounded-md px-1 text-xs tabular-nums text-blue-600 hover:bg-surface-2 dark:text-blue-400"
    >
      <Phone className="size-3 shrink-0" strokeWidth={2} aria-hidden />
      <span className="truncate">{number}</span>
    </a>
  );
}

const TableRow = memo(function TableRow({
  row,
  ctx,
  actions,
  selected,
  suggestion,
  preparing,
}: {
  row: SheetRow;
  ctx: RowContext;
  actions: RowActions;
  selected: boolean;
  suggestion: EmailSuggestion;
  preparing: boolean;
}) {
  const name = venueName(row);
  const c = row.contact;
  const phone = c?.phone ?? c?.whatsapp ?? null;
  return (
    <tr className={cn("align-top", selected ? "bg-blue-50/60 dark:bg-blue-950/25" : !isOpenStage(row.stage) && "bg-surface-2/40")}>
      {/* The stripe shows the status at a glance, like the phone cards. */}
      <td className={cn("border-l-[3px] py-3 pl-2.5 pr-0", STAGE_STRIPE[row.stage])}>
        <SelectBox checked={selected} label={`Select ${name}`} onChange={() => actions.onToggle(row.id)} />
      </td>
      <td className="px-3 py-2.5">
        {row.organization ? (
          <span className="inline">
            <Link href={`/organizations/${row.organization.id}`} className="font-medium text-fg [overflow-wrap:anywhere] hover:underline">
              {name}
            </Link>
            {row.organization.profile ? (
              <OrgProfileIconButton
                profile={row.organization.profile}
                organization={row.organization}
                editHref={`/organizations/${row.organization.id}?profile=edit`}
                className="-my-1 ml-1 align-middle"
              />
            ) : null}
          </span>
        ) : (
          <span className="font-medium [overflow-wrap:anywhere]">{name}</span>
        )}
        <RowBadges row={row} className="mt-1 flex" />
        {row.spaces ? <p className="mt-0.5 line-clamp-2 text-xs text-muted" title={row.spaces}>{row.spaces}</p> : null}
        <RowPlace row={row} block className="mt-0.5 text-xs text-subtle" />
      </td>
      <td className="px-3 py-2.5">
        {c ? (
          <>
            <span className="flex min-w-0 items-center gap-2">
              <ContactAvatar contact={c} size="xs" />
              <Link href={`/contacts/${c.id}`} className="block min-w-0 truncate text-fg hover:underline" title={c.displayName}>
                {c.displayName}
              </Link>
            </span>
            {c.role ? <p className="truncate text-xs text-muted" title={c.role}>{c.role}</p> : null}
            {c.email && c.email !== c.displayName ? (
              <a href={`mailto:${c.email}`} className="block truncate text-xs text-subtle hover:text-fg" title={c.email}>
                {c.email}
              </a>
            ) : null}
            {phone ? (
              <div className="-ml-1 mt-0.5 flex min-w-0 items-center gap-0.5">
                {telHref(c.phone) ? (
                  <CallLink phone={c.phone!} onCall={() => actions.onLog(row, "call")} />
                ) : (
                  <span className="truncate px-1 text-xs tabular-nums text-muted">{formatPhone(phone)}</span>
                )}
                <WhatsAppButton contact={c} onOpen={() => actions.onLog(row, "whatsapp")} />
              </div>
            ) : null}
          </>
        ) : (
          <p className="text-xs text-subtle">No contact</p>
        )}
        <LastTouchLine row={row} timezone={ctx.timezone} today={ctx.today} wrap className="mt-1" />
        <TimingBadge row={row} timezone={ctx.timezone} today={ctx.today} wrap className="mt-1" />
      </td>
      <td className="px-1 py-1.5">
        <StageCell rowId={row.id} value={row.stage} options={stageOptions(row.kind)} />
        <KindCell rowId={row.id} value={row.kind} />
      </td>
      <td className="px-1 py-1.5">
        <NextActionCell rowId={row.id} value={row.nextAction} />
        <TextCell rowId={row.id} name="nextStep" value={row.nextStep} placeholder="Detail" label="Next step detail" />
        <DateCell rowId={row.id} value={row.followUpAt} overdue={isFollowUpDue(row, ctx.today)} />
      </td>
      <td className="px-1 py-1.5">
        <TextCell rowId={row.id} name="eventDates" value={row.eventDates} placeholder="Dates" label="Dates" />
        <TextCell
          rowId={row.id}
          name="fee"
          value={row.value ? String(Number(row.value)) : null}
          placeholder="Fee"
          label={`Fee (${ctx.currency})`}
          inputMode="decimal"
        />
      </td>
      <td className="px-1 py-1.5">
        <TextCell rowId={row.id} name="notes" value={row.notes} placeholder="Notes" label="Notes" multiline rows={3} />
      </td>
      <td className="px-1.5 py-2.5">
        <PrepareEmailButton suggestion={suggestion} pending={preparing} onPrepare={() => actions.onPrepare(row)} size="compact" />
        <div className="mt-1.5 flex items-center justify-between">
          <HistoryButton count={row.activityCount} onOpen={() => actions.onHistory(row.id)} size="compact" />
          <DeleteRowButton rowId={row.id} name={name} />
        </div>
      </td>
    </tr>
  );
});
