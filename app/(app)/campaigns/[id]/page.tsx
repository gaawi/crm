import { headers } from "next/headers";
import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Download, MoreHorizontal, Settings2 } from "lucide-react";
import { buttonClass } from "@/components/ui/button";
import { AssistantSwitch } from "@/components/assistant/sheet-controls";
import { PageHeader } from "@/components/ui/layout";
import { getAssistantSettings } from "@/lib/queries/assistant";
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

export async function generateMetadata({ params }: PageProps<"/campaigns/[id]">): Promise<Metadata> {
  const { id } = await params;
  const sheet = await getSheet(id);
  return { title: sheet?.name ?? "Campaign" };
}

export default async function CampaignPage({ params }: PageProps<"/campaigns/[id]">) {
  const { id } = await params;
  // Rows still "To contact" that were emailed or called move to Contacted (cheap, set-based).
  await advanceSheetStages(id);
  const timezone = env.timezone;
  const today = todayIn(timezone);
  const sheet = await getSheet(id, today);
  if (!sheet) notFound();
  const [rows, templates, accounts, assistant] = await Promise.all([
    getSheetRows(sheet.id),
    listTemplates(sheet.id),
    listSendAccounts(),
    getAssistantSettings(sheet.id),
  ]);
  const sections = sheetSections(rows);
  const sendAccount = accounts.find((a) => a.id === sheet.sendAccountId) ?? accounts[0] ?? null;

  return (
    <div
      data-fullbleed
      className="mx-auto w-full max-w-[1500px] px-4 pb-[calc(env(safe-area-inset-bottom)+5.5rem)] pt-[calc(env(safe-area-inset-top)+0.5rem)] md:px-8 md:pb-8 md:pt-4"
    >
      <PageHeader
        compact
        back={{ href: "/campaigns", label: "Campaigns" }}
        title={sheet.name}
        description={
          sheet.description ??
          (rows.length
            ? "The organizations and people in this campaign: where each one stands and what comes next."
            : "Add the organizations and people for this campaign.")
        }
        actions={
          <>
            <AssistantSwitch projectId={sheet.id} active={assistant?.active ?? false} />
            {rows.length ? (
              <span className="hidden md:inline-flex">
                <a href={`/campaigns/${sheet.id}/export`} className={buttonClass("secondary", "md")} download>
                  <Download className="size-4" /> CSV
                </a>
              </span>
            ) : null}
            <ImportButton projectId={sheet.id} sections={sections} />
            <span className="hidden md:inline-flex">
              <Link href={`/campaigns/${sheet.id}/templates`} className={buttonClass("secondary", "md")}>
                <Settings2 className="size-4" /> Templates &amp; settings
              </Link>
            </span>
            <Dropdown trigger={<MoreHorizontal className="size-6" strokeWidth={1.75} />} label="More" className="md:hidden">
              <Link href={`/campaigns/${sheet.id}/templates`} className={menuItemClass}>
                <Settings2 className="size-4 text-muted" /> Templates &amp; settings
              </Link>
              {rows.length ? (
                <a href={`/campaigns/${sheet.id}/export`} download className={menuItemClass}>
                  <Download className="size-4 text-muted" /> Export CSV
                </a>
              ) : null}
            </Dropdown>
            <AddRowButton projectId={sheet.id} currency={sheet.currency} phonePrefix={sheet.phonePrefix} sections={sections} />
          </>
        }
      />

      <SheetView
        sheet={sheet}
        rows={rows}
        templates={templates}
        sendAccountEmail={sendAccount?.email ?? null}
        today={today}
        timezone={timezone}
        phoneHint={/iPhone|iPod|Android.*Mobile|Mobile Safari/i.test((await headers()).get("user-agent") ?? "")}
      />
    </div>
  );
}
