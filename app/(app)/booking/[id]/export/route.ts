import { assertSession, UnauthorizedError } from "@/lib/auth";
import { stageLabel } from "@/lib/constants";
import { getSheet, getSheetRows } from "@/lib/queries/booking";

/** GET /booking/[id]/export → the sheet as CSV (opens in Excel, Numbers or Google Sheets). */
export async function GET(_request: Request, { params }: RouteContext<"/booking/[id]/export">) {
  try {
    await assertSession();
  } catch (error) {
    if (error instanceof UnauthorizedError) return new Response("Unauthorized", { status: 401 });
    throw error;
  }
  const { id } = await params;
  const sheet = await getSheet(id);
  if (!sheet) return new Response("Not found", { status: 404 });
  const rows = await getSheetRows(sheet.id);

  // Quote every cell; a leading = + - @ is neutralised so spreadsheets never run it as a formula.
  const cell = (value: unknown) => {
    let text = value === null || value === undefined ? "" : String(value);
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  const header = ["Venue / presenter", "City", "Contact", "Role", "Email", "Status", "Last contact", "Follow up", "Next step", "Dates", `Fee (${sheet.currency})`, "Notes"];
  const lines = rows.map((r) =>
    [
      r.organization?.name ?? r.title,
      r.organization?.city,
      r.contact?.displayName,
      r.contact?.role,
      r.contact?.email,
      stageLabel(r.stage, "booking"),
      r.contact?.lastContactedAt ? new Date(r.contact.lastContactedAt).toISOString().slice(0, 10) : "",
      r.followUpAt,
      r.nextStep,
      r.eventDates,
      r.value,
      r.notes,
    ]
      .map(cell)
      .join(","),
  );
  const filename = `${sheet.name.replace(/[^\w\- ]+/g, "").trim() || "booking"}.csv`;
  return new Response(`﻿${[header.map(cell).join(","), ...lines].join("\r\n")}\r\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
