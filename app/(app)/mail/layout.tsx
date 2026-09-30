import type { Metadata } from "next";
import { MailProvider } from "@/components/mail/mail-provider";
import { requireSession } from "@/lib/auth";
import { env } from "@/lib/env";
import { accountDot } from "@/lib/mail/format";
import { getOwnAddresses } from "@/lib/queries/stats";
import { listAccounts } from "@/lib/sync/accounts";

export const metadata: Metadata = { title: "Mail" };

/**
 * Shared by every mail page: the composer and optimistic state live in a
 * client provider here, so a message being written survives navigation
 * between the list and threads. `data-fullbleed` opts out of the app's
 * centered max-width column.
 */
export default async function MailLayout({ children }: LayoutProps<"/mail">) {
  await requireSession();
  const [accounts, own] = await Promise.all([listAccounts(), getOwnAddresses()]);
  // Only what the client needs (never tokens); colors follow the account order everywhere.
  const options = accounts
    .map((a, index) => ({ id: a.id, email: a.email, displayName: a.displayName, dot: accountDot(index), status: a.status }))
    .filter((a) => a.status === "active")
    .map(({ status: _status, ...rest }) => rest);

  return (
    <MailProvider accounts={options} timezone={env.timezone} ownAddresses={[...own]}>
      <div data-fullbleed className="min-w-0">
        {children}
      </div>
    </MailProvider>
  );
}
