import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Download, MoreHorizontal, Settings2 } from "lucide-react";
import { buttonClass } from "@/components/ui/button";
import { NextActionsPanel } from "@/components/assistant/next-actions";
import { AssistantSwitch } from "@/components/assistant/sheet-controls";
import { PageHeader } from "@/components/ui/layout";
import { labelKindFor } from "@/lib/constants";
import { getAssistantSettings, listAssistantActions, listAssistantDrafts } from "@/lib/queries/assistant";
import { sheetSections } from "@/lib/booking/filters";
import { todayIn } from "@/lib/dates";
import { env } from "@/lib/env";
import { advanceSheetStages, getSheet, getSheetRows, listSendAccounts } from "@/lib/queries/booking";
import { listTemplates } from "@/lib/queries/templates";
import { Dropdown } from "../../_components/dropdown";
import { Segmented } from "../../_components/segmented";
import { menuItemClass } from "../../_components/ui";
import { AddRowButton } from "./add-row";
import { ImportButton } from "./import-dialog";
import { SheetView } from "./sheet-view";

export async function generateMetadata({ params }: PageProps<"/booking/[id]">): Promise<Metadata> {
  const { id } = await params;
  const sheet = await getSheet(id);
  return { title: sheet?.name ?? "Booking sheet" };
}

export default async function BookingSheetPage({ params, searchParams }: PageProps<"/booking/[id]">) {
  const { id } = await params;
  const tab = (await searchParams).tab === "next" ? "next" : "sheet";
  // Rows still "To contact" that were emailed or called move to Contacted (cheap, set-based).
  await advanceSheetStages(id);
  const timezone = env.timezone;
  const today = todayIn(timezone);
  const sheet = await getSheet(id, today);
  if (!sheet) notFound();
  const [rows, templates, accounts, assistant, pendingDrafts, openActions] = await Promise.all([
    getSheetRows(sheet.id),
    listTemplates(sheet.id),
    listSendAccounts(),
    getAssistantSettings(sheet.id),
    listAssistantDrafts({ projectId: sheet.id }),
    listAssistantActions({ projectId: sheet.id, excludeDrafted: true }),
  ]);
  const nextCount = pendingDrafts.length + openActions.length;
  const sections = sheetSections(rows);
  const sendAccount = accounts.find((a) => a.id === sheet.sendAccountId) ?? accounts[0] ?? null;

  return (
    <div
      data-fullbleed
      className="mx-auto w-full max-w-[1500px] px-4 pb-[calc(env(safe-area-inset-bottom)+5.5rem)] pt-[calc(env(safe-area-inset-top)+1rem)] md:px-8 md:py-8"
    >
      <PageHeader
        back={{ href: "/booking", label: "Booking" }}
        title={sheet.name}
        description={
          sheet.description ??
          (rows.length ? "Venues and presenters for this campaign: where each one stands and what comes next." : "Add the venues and presenters for this campaign.")
        }
        actions={
          <>
            <AssistantSwitch projectId={sheet.id} active={assistant?.active ?? false} />
            {rows.length ? (
              <span className="hidden md:inline-flex">
                <a href={`/booking/${sheet.id}/export`} className={buttonClass("secondary", "md")} download>
                  <Download className="size-4" /> CSV
                </a>
              </span>
            ) : null}
            <ImportButton projectId={sheet.id} sections={sections} />
            <span className="hidden md:inline-flex">
              <Link href={`/booking/${sheet.id}/templates`} className={buttonClass("secondary", "md")}>
                <Settings2 className="size-4" /> Templates &amp; settings
              </Link>
            </span>
            <Dropdown trigger={<MoreHorizontal className="size-6" strokeWidth={1.75} />} label="More" className="md:hidden">
              <Link href={`/booking/${sheet.id}/templates`} className={menuItemClass}>
                <Settings2 className="size-4 text-muted" /> Templates &amp; settings
              </Link>
              {rows.length ? (
                <a href={`/booking/${sheet.id}/export`} download className={menuItemClass}>
                  <Download className="size-4 text-muted" /> Export CSV
                </a>
              ) : null}
            </Dropdown>
            <AddRowButton projectId={sheet.id} currency={sheet.currency} phonePrefix={sheet.phonePrefix} sections={sections} />
          </>
        }
      />

      <Segmented
        label="Sheet views"
        fill={false}
        className="mb-4 md:mb-5"
        segments={[
          { href: `/booking/${sheet.id}`, label: "Sheet", active: tab === "sheet", count: rows.length },
          { href: `/booking/${sheet.id}?tab=next`, label: "Next actions", active: tab === "next", count: nextCount || undefined },
        ]}
      />

      {tab === "next" ? (
        <NextActionsPanel sheet={sheet} labelKind={labelKindFor(sheet.kinds)} today={today} timezone={timezone} />
      ) : (
        <SheetView sheet={sheet} rows={rows} templates={templates} sendAccountEmail={sendAccount?.email ?? null} today={today} timezone={timezone} />
      )}
    </div>
  );
}
