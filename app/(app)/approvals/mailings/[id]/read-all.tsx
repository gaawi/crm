import Link from "next/link";
import type { EmailDraft } from "@/lib/types";

/** **bold** words as they will look in the email (the plain-text part drops the asterisks). */
function withBold(text: string) {
  return text.split(/\*\*([^*\n]+?)\*\*/g).map((piece, i) => (i % 2 ? <strong key={i}>{piece}</strong> : piece));
}

/**
 * Every email of a mass mailing in full, one after another: who it goes to,
 * the subject and the whole text, to read quickly before approving them all.
 * "Edit" opens that email in the editing view.
 */
export function ReadAll({ drafts, mailingId }: { drafts: EmailDraft[]; mailingId: string }) {
  return (
    <ol className="flex flex-col gap-3">
      {drafts.map((d, i) => (
        <li key={d.id} id={`email-${d.id}`} className="min-w-0 scroll-mt-20 rounded-xl border border-border bg-surface px-4 py-3 md:rounded-lg">
          <div className="flex items-baseline gap-2 text-[13px] text-muted md:text-xs">
            <span className="tabular-nums text-subtle">{i + 1}</span>
            <span className="min-w-0 flex-1 truncate">
              <span className="font-medium text-fg">{d.contact?.displayName ?? d.to.join(", ")}</span>
              {d.contact?.displayName ? ` · ${d.to.join(", ")}` : ""}
            </span>
            <Link href={`/approvals/mailings/${mailingId}?view=edit&open=${d.id}`} className="shrink-0 text-blue-600 hover:underline dark:text-blue-400">
              Edit
            </Link>
          </div>
          <h3 className="mt-1.5 text-[15px] font-semibold leading-snug text-fg md:text-sm">{d.subject || "(no subject)"}</h3>
          <div className="mt-1 whitespace-pre-wrap text-[14px] leading-[1.5] text-fg md:text-[13.5px]">{withBold(d.body)}</div>
          {d.rationale ? <p className="mt-2 border-t border-border pt-2 text-[12.5px] leading-snug text-muted md:text-xs">{d.rationale}</p> : null}
        </li>
      ))}
    </ol>
  );
}
