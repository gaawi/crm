import type { ReactNode } from "react";
import { MailProvider } from "@/components/mail/mail-provider";
import { env } from "@/lib/env";
import { accountDot } from "@/lib/mail/format";
import { accountsForRender, ownAddressesForRender } from "@/lib/queries/render-cache";

/**
 * The mail composer for the whole app, not only Mail: "Reply" on a campaign
 * row, in Today or on a contact opens it right there (like Gmail's compose
 * window), so nobody is sent away from where they were. A message being
 * written also survives moving between pages.
 */
export async function AppMailProvider({ children }: { children: ReactNode }) {
  const [accounts, own] = await Promise.all([accountsForRender(), ownAddressesForRender()]);
  // Only what the client needs (never tokens); colors follow the account order everywhere.
  const options = accounts
    .filter((a) => a.status !== "disconnected")
    .flatMap((a, index) => (a.status === "active" ? [{ id: a.id, email: a.email, displayName: a.displayName, dot: accountDot(index), monitorOnly: a.monitorOnly }] : []));
  return (
    <MailProvider accounts={options} timezone={env.timezone} ownAddresses={[...own]}>
      {children}
    </MailProvider>
  );
}
