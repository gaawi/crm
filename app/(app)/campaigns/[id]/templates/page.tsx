import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/layout";
import { rowTemplateVars, type TemplateVars } from "@/lib/booking/templates";
import { TEMPLATE_VARIABLES } from "@/lib/constants";
import { getSheet, getSheetRows, listSendAccounts, listSheets } from "@/lib/queries/booking";
import { getSettings } from "@/lib/queries/settings";
import { listTemplates } from "@/lib/queries/templates";
import { SheetSettingsForm } from "./settings-form";
import { TemplatesManager, type PreviewRow } from "./templates-manager";

export const metadata: Metadata = { title: "Templates & settings" };

/** Rows offered in the editor's "Preview with" picker. */
const PREVIEW_ROWS = 200;

/** /campaigns/[id]/templates: the sheet's email templates (with live preview) and its settings. */
export default async function SheetTemplatesPage({ params }: PageProps<"/campaigns/[id]/templates">) {
  const { id } = await params;
  const sheet = await getSheet(id);
  if (!sheet) notFound();
  const [templates, accounts, sheets, rows, profile] = await Promise.all([
    listTemplates(sheet.id),
    listSendAccounts(),
    listSheets(),
    getSheetRows(sheet.id),
    getSettings("profile"),
  ]);

  const previewRows: PreviewRow[] = rows.slice(0, PREVIEW_ROWS).map((row) => ({
    id: row.id,
    label: [row.organization?.name ?? row.title, row.contact?.name].filter(Boolean).join(" · "),
    vars: rowTemplateVars(row, sheet, profile),
  }));
  // A sheet without rows previews with sample values (and the real sheet name and signature).
  const exampleVars: TemplateVars = {
    ...Object.fromEntries(TEMPLATE_VARIABLES.map((v) => [v.name, v.example])),
    sheet: sheet.name,
    ...(profile.name ? { my_name: profile.name } : {}),
    ...(profile.signature ? { signature: profile.signature } : {}),
  };

  return (
    <>
      <PageHeader
        back={{ href: `/campaigns/${sheet.id}`, label: sheet.name }}
        title="Templates & settings"
        description="The emails “Prepare email” starts from, and how this campaign handles phone numbers and sending. Prepared emails always wait in Approvals."
      />
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start lg:gap-6">
        <TemplatesManager
          projectId={sheet.id}
          sheetName={sheet.name}
          templates={templates}
          previewRows={previewRows}
          exampleVars={exampleVars}
          otherSheets={sheets.filter((s) => s.id !== sheet.id).map((s) => ({ id: s.id, name: s.name }))}
          hasSignature={Boolean(profile.signature?.trim())}
        />
        <SheetSettingsForm
          sheet={{
            id: sheet.id,
            name: sheet.name,
            currency: sheet.currency,
            phonePrefix: sheet.phonePrefix,
            sendAccountId: sheet.sendAccountId,
            description: sheet.description,
          }}
          accounts={accounts}
        />
      </div>
    </>
  );
}
