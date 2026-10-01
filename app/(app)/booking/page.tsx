import Link from "next/link";
import type { Metadata } from "next";
import { ChevronRight } from "lucide-react";
import { ProjectDot } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { EmptyState, PageHeader } from "@/components/ui/layout";
import { todayIn } from "@/lib/dates";
import { env } from "@/lib/env";
import { listSheets } from "@/lib/queries/booking";
import { ActionForm, FormSubmit } from "../_components/action-form";
import { FormActions, GroupTitle, HeaderAddButton } from "../_components/ui";
import { param } from "../_lib/url";
import { createSheetAction } from "./actions";

export const metadata: Metadata = { title: "Booking" };

export default async function BookingPage({ searchParams }: PageProps<"/booking">) {
  const sp = await searchParams;
  const creating = param(sp, "new") === "1";
  const sheets = await listSheets(todayIn(env.timezone));

  return (
    <>
      <PageHeader
        title="Booking"
        description="One sheet per campaign: the venues and presenters you are pitching, where each one stands and what comes next."
        actions={<HeaderAddButton href="/booking?new=1" label="New sheet" />}
      />

      {creating ? (
        <section className="mb-8" aria-label="New sheet">
          <GroupTitle>New booking sheet</GroupTitle>
          <ActionForm action={createSheetAction} className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4 md:rounded-lg">
            <div className="grid gap-3 md:grid-cols-[1fr_10rem]">
              <Field label="Name">
                <Input name="name" required autoFocus placeholder="Gira España 2027 · CreArtBox" />
              </Field>
              <Field label="Currency">
                <Select name="currency" defaultValue="USD">
                  <option value="USD">USD $</option>
                  <option value="EUR">EUR €</option>
                  <option value="GBP">GBP £</option>
                </Select>
              </Field>
            </div>
            <FormActions>
              <FormSubmit pendingLabel="Creating…">Create sheet</FormSubmit>
              <ButtonLink href="/booking" variant="ghost">
                Cancel
              </ButtonLink>
            </FormActions>
          </ActionForm>
        </section>
      ) : null}

      {sheets.length ? (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface md:rounded-lg">
          {sheets.map((s) => (
            <li key={s.id}>
              <Link href={`/booking/${s.id}`} className="flex min-h-[64px] items-center gap-3 px-4 py-3 active:bg-surface-2 md:hover:bg-surface-2/60">
                <ProjectDot color={s.color} className="size-2.5" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[17px] font-medium text-fg md:text-sm">{s.name}</p>
                  <p className="mt-0.5 text-[13px] text-muted md:text-xs">
                    {s.rows} {s.rows === 1 ? "venue" : "venues"} · {s.open} open · {s.confirmed} confirmed
                    {s.declined ? ` · ${s.declined} declined` : ""} · {s.currency}
                  </p>
                </div>
                {s.followUpsDue ? (
                  <span className="shrink-0 rounded-full bg-danger/10 px-2 py-0.5 text-xs font-medium text-danger">
                    {s.followUpsDue} follow-up{s.followUpsDue === 1 ? "" : "s"} due
                  </span>
                ) : null}
                <ChevronRight className="size-5 shrink-0 text-subtle md:size-4" />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="No booking sheets yet" action={<ButtonLink href="/booking?new=1" variant="primary">New sheet</ButtonLink>}>
          Create one per campaign, e.g. “Booking USA 2026/27” or “Gira España 2027”.
        </EmptyState>
      )}
    </>
  );
}
