import { assertSession, UnauthorizedError } from "@/lib/auth";
import { ACTIVITY_KINDS, CALL_OUTCOMES, goalLabel, nextActionLabel, stageLabel } from "@/lib/constants";
import type { ActivityView, SheetRowActivity } from "@/lib/booking/types";
import { toISODate } from "@/lib/dates";
import { env } from "@/lib/env";
import { sheetActivities } from "@/lib/queries/activities";
import { getSheet, getSheetRows } from "@/lib/queries/booking";

const kindLabel = (kind: string) => ACTIVITY_KINDS.find((k) => k.value === kind)?.label ?? kind;
const outcomeLabel = (outcome: string | null) => (outcome ? (CALL_OUTCOMES.find((o) => o.value === outcome)?.label ?? outcome) : null);

/** "2026-09-28 Call (Talked): Interested, send the dossier" */
function describe(a: ActivityView | SheetRowActivity, withBody: boolean): string {
  const outcome = outcomeLabel(a.outcome);
  const head = `${toISODate(new Date(a.occurredAt), env.timezone)} ${kindLabel(a.kind)}${outcome ? ` (${outcome})` : ""}`;
  const body = a.body?.replace(/\s+/g, " ").trim();
  return withBody && body ? `${head}: ${body}` : head;
}

/** GET /campaigns/[id]/export → the sheet as CSV (opens in Excel, Numbers or Google Sheets). */
export async function GET(_request: Request, { params }: RouteContext<"/campaigns/[id]/export">) {
  try {
    await assertSession();
  } catch (error) {
    if (error instanceof UnauthorizedError) return new Response("Unauthorized", { status: 401 });
    throw error;
  }
  const { id } = await params;
  const sheet = await getSheet(id);
  if (!sheet) return new Response("Not found", { status: 404 });
  const [rows, history] = await Promise.all([getSheetRows(sheet.id), sheetActivities(sheet.id)]);

  // Quote every cell; a leading = + - @ is neutralised so spreadsheets never run it as a formula.
  const cell = (value: unknown) => {
    let text = value === null || value === undefined ? "" : String(value);
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  const header = [
    "Organization",
    "Section",
    "City",
    "Spaces",
    "Returning",
    "Contact",
    "Role",
    "Email",
    "Phone",
    "WhatsApp",
    "Goal",
    "Status",
    "Last contact",
    "Last activity",
    "Follow up",
    "Next action",
    "Next step",
    "Dates",
    `Fee (${sheet.currency})`,
    "Notes",
    "History",
  ];
  const lines = rows.map((r) =>
    [
      r.organization?.name ?? r.title,
      r.section,
      r.organization?.city,
      r.spaces,
      r.returning ? "Yes" : "",
      r.contact?.displayName,
      r.contact?.role,
      r.contact?.email,
      r.contact?.phone,
      r.contact?.whatsapp,
      goalLabel(r.kind),
      stageLabel(r.stage, r.kind),
      r.contact?.lastContactedAt ? toISODate(new Date(r.contact.lastContactedAt), env.timezone) : "",
      r.lastActivity ? describe(r.lastActivity, false) : "",
      r.followUpAt,
      nextActionLabel(r.nextAction),
      r.nextStep,
      r.eventDates,
      r.value,
      r.notes,
      (history.get(r.id) ?? []).map((a) => describe(a, true)).join(" | "),
    ]
      .map(cell)
      .join(","),
  );
  const filename = `${sheet.name.replace(/[^\w\- ]+/g, "").trim() || "campaign"}.csv`;
  return new Response(`﻿${[header.map(cell).join(","), ...lines].join("\r\n")}\r\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
