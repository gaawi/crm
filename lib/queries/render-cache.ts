import "server-only";
import { cache } from "react";
import { getMailCounts } from "@/lib/mail/queries";
import { countPendingDrafts } from "@/lib/queries/drafts";
import { getOverviewCounts, getOwnAddresses } from "@/lib/queries/stats";
import { listAccounts } from "@/lib/sync/accounts";

/**
 * Reads shared by the layouts and the page of one render, deduplicated per
 * request with React's cache() (the app layout, the Mail layout and the Mail
 * chrome all ask for the accounts and the mail counts). Only for rendering:
 * server actions that change data must call the plain functions.
 */
export const accountsForRender = cache(() => listAccounts());
export const ownAddressesForRender = cache(() => getOwnAddresses());
export const mailCountsForRender = cache((accountId: string | null) => getMailCounts(accountId));

/** The badges of the app navigation and the reconnect banner. */
export const navCountsForRender = cache(async () => {
  const [approvals, overview, mail] = await Promise.all([countPendingDrafts(), getOverviewCounts(), mailCountsForRender(null)]);
  return {
    approvals,
    mail: mail.inbox.primary,
    accountsNeedingReauth: overview.accountsNeedingReauth,
  };
});
