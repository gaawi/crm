import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DraftCard } from "@/components/draft-card";
import { EmailTimeline } from "@/components/email-timeline";
import { PageHeader, SectionTitle } from "@/components/ui/layout";
import { env } from "@/lib/env";
import { getContactHistory } from "@/lib/queries/contacts";
import { getDraft, recoverStaleDrafts } from "@/lib/queries/drafts";
import { getOwnAddresses } from "@/lib/queries/stats";

export const metadata: Metadata = { title: "Review email" };

/** Full review of one proposed email, with the recent conversation for context. */
export default async function DraftReviewPage({ params }: PageProps<"/approvals/[id]">) {
  const { id } = await params;
  await recoverStaleDrafts();
  const draft = await getDraft(id);
  if (!draft) notFound();
  const timezone = env.timezone;
  const [history, self] = await Promise.all([
    draft.contact ? getContactHistory(draft.contact.id, { limit: 6 }) : Promise.resolve([]),
    getOwnAddresses(),
  ]);

  return (
    <>
      <PageHeader
        back={{ href: "/approvals", label: "Approvals" }}
        title={draft.contact ? `Email to ${draft.contact.displayName}` : "Review email"}
      />
      <div className="grid gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] [&>*]:min-w-0">
        <DraftCard draft={draft} timezone={timezone} />
        {history.length ? (
          <section>
            <SectionTitle>Conversation so far</SectionTitle>
            <EmailTimeline messages={history} timezone={timezone} selfEmails={self} />
          </section>
        ) : null}
      </div>
    </>
  );
}
