import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Download, MoreHorizontal, Settings2 } from "lucide-react";
import { buttonClass } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/layout";
import { sheetSections } from "@/lib/booking/filters";
import { todayIn } from "@/lib/dates";
import { env } from "@/lib/env";
import { advanceSheetStages, getSheet, getSheetRows, listSendAccounts } from "@/lib/queries/booking";
import { listTemplates } from "@/lib/queries/templates";
import { Dropdown } from "../../_components/dropdown";
import { menuItemClass } from "../../_components/ui";
import { AddRowButton } from "./add-row";
import { ImportButton } from "./import-dialog";
import { SheetView } from "./sheet-view";

export async function generateMetadata({ params }: PageProps<"/booking/[id]">): Promise<Metadata> {
  const { id } = await params;
  const sheet = await getSheet(id);
  return { title: sheet?.name ?? "Booking sheet" };
}

export default async function BookingSheetPage({ params }: PageProps<"/booking/[id]">) {
  const { id } = await params;
  // Rows still "To contact" that were emailed or called move to Contacted (cheap, set-based).
  await advanceSheetStages(id);
  const timezone = env.timezone;
  const today = todayIn(timezone);
  const sheet = await getSheet(id, today);
  if (!sheet) notFound();
  const [rows, templates, accounts] = await Promise.all([getSheetRows(sheet.id), listTemplates(sheet.id), listSendAccounts()]);
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

      <SheetView sheet={sheet} rows={rows} templates={templates} sendAccountEmail={sendAccount?.email ?? null} today={today} timezone={timezone} />
    </div>
  );
}
