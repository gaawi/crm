import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Download } from "lucide-react";
import { buttonClass } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/layout";
import { OPPORTUNITY_STAGES, stageLabel } from "@/lib/constants";
import { formatRelative, todayIn } from "@/lib/dates";
import { env } from "@/lib/env";
import { getSheet, getSheetRows, type SheetRow } from "@/lib/queries/booking";
import { cn } from "@/lib/utils";
import { AddRowPanel } from "./add-row";
import { DateCell, DeleteRowButton, StageCell, TextCell } from "./cells";

export const metadata: Metadata = { title: "Booking sheet" };

const STAGES = OPPORTUNITY_STAGES.map((s) => ({ value: s.value, label: stageLabel(s.value, "booking") }));

function lastEmail(row: SheetRow, timezone: string): { text: string; tone: "muted" | "reply" | "waiting" } {
  const c = row.contact;
  if (!c) return { text: "No contact", tone: "muted" };
  if (c.awaitingReplySince) return { text: `Waiting on them · ${formatRelative(c.awaitingReplySince, timezone)}`, tone: "waiting" };
  if (c.lastInboundAt && (!c.lastOutboundAt || new Date(c.lastInboundAt) > new Date(c.lastOutboundAt))) {
    return { text: `They wrote ${formatRelative(c.lastInboundAt, timezone)}`, tone: "reply" };
  }
  if (c.lastOutboundAt) return { text: `You wrote ${formatRelative(c.lastOutboundAt, timezone)}`, tone: "muted" };
  return { text: "No emails yet", tone: "muted" };
}

const toneClass = { muted: "text-muted", reply: "font-medium text-accent", waiting: "text-warning" };

export default async function BookingSheetPage({ params }: PageProps<"/booking/[id]">) {
  const { id } = await params;
  const sheet = await getSheet(id);
  if (!sheet) notFound();
  const timezone = env.timezone;
  const today = todayIn(timezone);
  const rows = await getSheetRows(sheet.id);
  const counts = STAGES.map((s) => ({ ...s, n: rows.filter((r) => r.stage === s.value).length })).filter((s) => s.n > 0);
  const due = rows.filter((r) => r.followUpAt && r.followUpAt <= today && r.stage !== "won" && r.stage !== "lost").length;

  return (
    <div
      data-fullbleed
      className="mx-auto w-full max-w-[1500px] px-4 pb-[calc(env(safe-area-inset-bottom)+5.5rem)] pt-[calc(env(safe-area-inset-top)+1rem)] md:px-8 md:py-8"
    >
      <PageHeader
        back={{ href: "/booking", label: "Booking" }}
        title={sheet.name}
        description={
          rows.length
            ? `${rows.length} ${rows.length === 1 ? "venue" : "venues"} · ${counts.map((c) => `${c.n} ${c.label.toLowerCase()}`).join(" · ")}${due ? ` · ${due} follow-up${due === 1 ? "" : "s"} due` : ""}`
            : "Add the venues and presenters for this campaign."
        }
        actions={
          rows.length ? (
            <a href={`/booking/${sheet.id}/export`} className={buttonClass("secondary", "md")} download>
              <Download className="size-4" /> CSV
            </a>
          ) : null
        }
      />

      <AddRowPanel projectId={sheet.id} currency={sheet.currency} initiallyOpen={rows.length === 0} />

      {rows.length ? (
        <>
          {/* Desktop: a sheet. */}
          <div className="hidden overflow-x-auto rounded-lg border border-border bg-surface md:block">
            <table className="w-full min-w-[980px] table-fixed border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs font-medium text-subtle">
                  <th className="w-[10.5rem] px-3 py-2 font-medium">Venue / presenter</th>
                  <th className="w-[12rem] px-3 py-2 font-medium">Contact · last email</th>
                  <th className="w-[8.5rem] px-1 py-2 font-medium">Status</th>
                  <th className="w-[11.5rem] px-1 py-2 font-medium">Next step · follow up</th>
                  <th className="w-[8rem] px-1 py-2 font-medium">Dates · fee ({sheet.currency})</th>
                  <th className="px-1 py-2 font-medium">Notes</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((row) => {
                  const email = lastEmail(row, timezone);
                  const overdue = Boolean(row.followUpAt && row.followUpAt <= today && row.stage !== "won" && row.stage !== "lost");
                  return (
                    <tr key={row.id} className={cn("align-top", (row.stage === "won" || row.stage === "lost") && "bg-surface-2/40")}>
                      <td className="px-3 py-2.5">
                        {row.organization ? (
                          <Link href={`/organizations/${row.organization.id}`} className="font-medium text-fg hover:underline">
                            {row.organization.name}
                          </Link>
                        ) : (
                          <span className="font-medium">{row.title}</span>
                        )}
                        {row.organization?.city ? <p className="text-xs text-muted">{row.organization.city}</p> : null}
                      </td>
                      <td className="px-3 py-2.5">
                        {row.contact ? (
                          <>
                            <Link href={`/contacts/${row.contact.id}`} className="block truncate text-fg hover:underline">
                              {row.contact.displayName}
                            </Link>
                            {row.contact.role ? <p className="truncate text-xs text-muted">{row.contact.role}</p> : null}
                            {row.contact.email ? (
                              <a href={`mailto:${row.contact.email}`} className="block truncate text-xs text-subtle hover:text-fg">
                                {row.contact.email}
                              </a>
                            ) : null}
                          </>
                        ) : null}
                        <p className={cn("mt-1 text-xs", toneClass[email.tone])}>{email.text}</p>
                      </td>
                      <td className="px-1 py-1.5">
                        <StageCell rowId={row.id} value={row.stage} options={STAGES} />
                      </td>
                      <td className="px-1 py-1.5">
                        <TextCell rowId={row.id} name="nextStep" value={row.nextStep} placeholder="Next step" label="Next step" />
                        <DateCell rowId={row.id} value={row.followUpAt} overdue={overdue} />
                      </td>
                      <td className="px-1 py-1.5">
                        <TextCell rowId={row.id} name="eventDates" value={row.eventDates} placeholder="Dates" label="Dates" />
                        <TextCell rowId={row.id} name="fee" value={row.value ? String(Number(row.value)) : null} placeholder="Fee" label="Fee" />
                      </td>
                      <td className="px-1 py-1.5">
                        <TextCell rowId={row.id} name="notes" value={row.notes} placeholder="Notes" label="Notes" multiline rows={3} />
                      </td>
                      <td className="px-1 py-1.5">
                        <DeleteRowButton rowId={row.id} name={row.organization?.name ?? row.title} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Phone: one card per venue. */}
          <ul className="flex flex-col gap-3 md:hidden">
            {rows.map((row) => {
              const email = lastEmail(row, timezone);
              const overdue = Boolean(row.followUpAt && row.followUpAt <= today && row.stage !== "won" && row.stage !== "lost");
              return (
                <li key={row.id} className="rounded-xl border border-border bg-surface p-3">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1 px-1">
                      {row.organization ? (
                        <Link href={`/organizations/${row.organization.id}`} className="text-[17px] font-semibold text-fg">
                          {row.organization.name}
                        </Link>
                      ) : (
                        <span className="text-[17px] font-semibold">{row.title}</span>
                      )}
                      <p className="text-[13px] text-muted">
                        {[row.organization?.city, row.contact?.displayName].filter(Boolean).join(" · ") || "—"}
                      </p>
                      <p className={cn("mt-0.5 text-[13px]", toneClass[email.tone])}>{email.text}</p>
                    </div>
                    <DeleteRowButton rowId={row.id} name={row.organization?.name ?? row.title} />
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <StageCell rowId={row.id} value={row.stage} options={STAGES} />
                    <DateCell rowId={row.id} value={row.followUpAt} overdue={overdue} />
                  </div>
                  <TextCell rowId={row.id} name="nextStep" value={row.nextStep} placeholder="Next step" label="Next step" />
                  <div className="grid grid-cols-2 gap-2">
                    <TextCell rowId={row.id} name="eventDates" value={row.eventDates} placeholder="Dates" label="Dates" />
                    <TextCell rowId={row.id} name="fee" value={row.value ? String(Number(row.value)) : null} placeholder={`Fee ${sheet.currency}`} label="Fee" />
                  </div>
                  <TextCell rowId={row.id} name="notes" value={row.notes} placeholder="Notes" label="Notes" multiline />
                  {row.contact?.email ? (
                    <a href={`mailto:${row.contact.email}`} className="mt-1 block truncate px-2 text-[13px] text-subtle">
                      {row.contact.email}
                    </a>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
    </div>
  );
}
