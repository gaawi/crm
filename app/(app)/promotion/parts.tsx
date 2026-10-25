import Link from "next/link";
import type { PartnerRelationship } from "@/lib/listings/relationship";
import type { PartnerThread } from "@/lib/queries/listings";

/** A ticketing partner's story, summarized from the emails. */
export function Relationship({ relationship: r }: { relationship: PartnerRelationship }) {
  const facts = [
    ["Members pay", r.priceToMembers],
    ["We receive", r.paidToUs],
    ["Usual tickets", r.typicalTickets],
    ["Account", r.login],
  ].filter((f): f is [string, string] => Boolean(f[1]));
  return (
    <section className="flex flex-col gap-3 text-[13px] text-muted md:text-xs">
      <h3 className="text-xs font-medium uppercase tracking-wide text-subtle">The relationship</h3>
      {r.howItWorks ? <p className="whitespace-pre-line">{r.howItWorks}</p> : null}
      {facts.length ? (
        <dl className="grid gap-x-3 gap-y-1 sm:grid-cols-[8rem_1fr]">
          {facts.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="font-medium text-fg">{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {r.contacts.length ? (
        <ul className="flex flex-col gap-0.5">
          {r.contacts.map((c, i) => (
            <li key={i}>
              <span className="text-fg">{c.name ?? c.email}</span>
              {c.role ? ` · ${c.role}` : ""}
              {c.email && c.name ? (
                <>
                  {" · "}
                  <a href={`mailto:${c.email}`} className="underline-offset-2 hover:underline">
                    {c.email}
                  </a>
                </>
              ) : null}
              {c.lastSeen ? ` · last ${c.lastSeen}` : ""}
            </li>
          ))}
        </ul>
      ) : null}
      {r.concerts.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[28rem] text-left">
            <thead className="text-subtle">
              <tr>
                <th className="py-1 pr-2 font-medium">Concert</th>
                <th className="py-1 pr-2 font-medium">Offered</th>
                <th className="py-1 pr-2 font-medium">Taken</th>
                <th className="py-1 pr-2 font-medium">Members pay</th>
                <th className="py-1 font-medium">We receive</th>
              </tr>
            </thead>
            <tbody>
              {r.concerts.map((c, i) => (
                <tr key={i} className="border-t border-border align-top" title={c.notes ?? undefined}>
                  <td className="py-1 pr-2">
                    <span className="text-fg">{c.date}</span> {c.title}
                  </td>
                  <td className="py-1 pr-2 tabular-nums">{c.ticketsOffered ?? ""}</td>
                  <td className="py-1 pr-2 tabular-nums">{c.ticketsTaken ?? ""}</td>
                  <td className="py-1 pr-2">{c.priceToMembers ?? ""}</td>
                  <td className="py-1">{c.paidToUs ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {r.openItems.length ? (
        <div>
          <p className="font-medium text-fg">Pending</p>
          <ul className="list-disc pl-4">
            {r.openItems.map((o, i) => (
              <li key={i}>{o}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {r.timeline.length ? (
        <details>
          <summary className="cursor-pointer text-fg">History ({r.timeline.length})</summary>
          <ol className="mt-1 flex flex-col gap-1">
            {r.timeline.map((t, i) => (
              <li key={i}>
                <span className="tabular-nums text-fg">{t.date}</span> {t.direction === "out" ? "→" : t.direction === "in" ? "←" : ""} {t.who ? `${t.who}: ` : ""}
                {t.summary}
              </li>
            ))}
          </ol>
        </details>
      ) : null}
      {r.notes ? <p className="whitespace-pre-line">{r.notes}</p> : null}
      {r.reviewedAt ? <p className="text-subtle">Summarized from the emails on {r.reviewedAt}.</p> : null}
    </section>
  );
}

/** The latest email threads with a partner, linked to the thread in Mail. */
export function PartnerEmails({ threads }: { threads: PartnerThread[] }) {
  return (
    <section className="text-[13px] md:text-xs">
      <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-subtle">Emails</h3>
      <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
        {threads.map((t) => (
          <li key={`${t.accountId}-${t.threadId}`}>
            <Link href={`/mail/t/${t.accountId}/${t.threadId}`} className="flex items-baseline gap-2 px-2.5 py-1.5 hover:bg-surface-2">
              <span className="w-20 shrink-0 tabular-nums text-subtle">{t.lastAt.toISOString().slice(0, 10)}</span>
              <span className="min-w-0 flex-1 truncate text-fg">{t.subject || "(no subject)"}</span>
              <span className="shrink-0 text-subtle">
                {t.lastDirection === "outbound" ? "sent" : "received"}
                {t.count > 1 ? ` · ${t.count}` : ""}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
