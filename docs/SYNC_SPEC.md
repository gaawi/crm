# Gmail sync — implementation spec

This is the authoritative spec for `lib/sync/*`, the sync routes and their
tests. It incorporates the design review (see git history). Contracts (names,
signatures, doc comments) live in the source files; this document explains the
behaviour they must have.

## Principles

- **Never lose mail silently.** Every path either stores the message, records
  why not in `gmail_accounts.last_error`, or leaves the cursor where it can be
  retried.
- **Idempotent everywhere.** Upserts on `(account_id, gmail_message_id)`,
  fetched labels decide inclusion, cursors only move forward
  (`history_id = greatest(history_id, $1::bigint)` in SQL — never compare
  history ids as JS strings).
- **Gmail quota**: 6,000 units/min/user; `messages.get` = 20 units. The
  `GmailClient` paces requests (default 4/s) and retries rate limits. One
  `GmailClient` instance per job so pacing is shared within the job.
- **Transaction pooler**: no session-level locks. Leases are columns;
  contact creation uses `pg_advisory_xact_lock`.
- **Vercel**: functions run ≤ 300 s (`maxDuration = 300`, deadline =
  `deadlineFor(300)`). Self-request chains are capped at `MAX_CHAIN_HOPS` (Vercel
  returns 508 for long self-call chains); fresh chains start from the cron,
  Pub/Sub pushes, the Settings page and page visits.

## What is stored

A fetched message is **importable** unless its *current* labels
(`shouldSkipLabels`) include SPAM, TRASH, DRAFT, CHAT, SCHEDULED or a
`SYNC_SKIP_CATEGORIES` category (default: none — Promotions/Social are stored
but flagged automated). Already-stored messages are never deleted because they
were trashed or permanently deleted in Gmail (the CRM keeps history); their
`label_ids` are updated (trash → `TRASH` label; permanent deletion → add the
pseudo-label `DELETED`) so mail-client views can hide them. **SPAM** is the one
exception: a message moved to spam is deleted from the CRM.

## lib/sync/rules.ts

- `selectContactCandidates(message, self)`:
  - outbound: every to/cc/bcc address, unless there are more than
    `MAX_RECIPIENTS_FOR_AUTO_CONTACTS` recipients;
  - inbound, not automated: the sender;
  - inbound whose sender is a no-reply address and whose Reply-To has a real,
    non-self, non-no-reply address: that Reply-To address (contact forms) —
    even though the message is automated;
  - never self addresses, no-reply addresses, or invalid addresses (same rule
    as the DB check: lower-case, contains `@`, no whitespace).
- `participantRows(message)`: from, to, cc, bcc, and `reply_to` (only
  addresses that differ from the sender), de-duplicated per (role, email).
  Return type must include the `"reply_to"` role.
- `cleanDisplayName(name, email)`.

## lib/sync/ingest.ts

`ingestMessages(accountId, parsed[], self)` in **one transaction**:

1. For each message inside its own **savepoint** (`tx.savepoint`), so one bad
   message never aborts the batch:
   `insert … on conflict (account_id, gmail_message_id) do update set label_ids =
   excluded.label_ids where messages.label_ids is distinct from excluded.label_ids
   returning id, (xmax = 0) as inserted` — message content is immutable, so only
   labels are refreshed. Store `automated_reason`. Insert
   `message_participants` only for newly inserted rows. Failures are collected
   (`failed: {gmailMessageId, error}[]`), not thrown.
2. Contact creation under `pg_advisory_xact_lock(hashtext('crm:contact-create'))`:
   for every candidate address not yet in `contact_emails` → insert a contact
   (`status 'new'`, `source 'gmail'`, name from `cleanDisplayName`,
   organization = the organization whose `domains` contains the address's
   domain, never for `FREE_MAIL_DOMAINS`) and its primary address. Existing
   contacts with an empty name get the display name.
3. If the account has `default_project_id`, add every candidate's contact
   (new or existing) to that project (`on conflict do nothing`).
4. `refresh_contact_stats` for every contact owning any participant address of
   the batch.

Returns `{ stored, contactsCreated, contactIds, failed }` (add `failed` to the
`IngestResult` interface).

Also:

- `deleteMessages(accountId, gmailIds)` (spam): in one transaction collect the
  affected contact ids first (participants cascade-delete), delete, refresh.
- `existingMessageIds(accountId, ids)`.
- `updateMessageLabels(accountId, changes: {gmailMessageId, labelIds}[])`:
  label-only updates for stored messages (no fetch, no stats refresh unless a
  message becomes/stops being importable — stats do not depend on labels).
- `markMessagesDeleted(accountId, gmailIds)`: add the `DELETED` pseudo-label.

## lib/sync/accounts.ts

Implement every TODO per its doc comment. Notes:

- Tokens are stored with `encryptSecret`; `getAccessToken` caches the access
  token encrypted with its expiry; refresh when < 60 s left; `invalid_grant`
  → `status 'reauth_required'`, `last_error`, throw `AccountAuthError`.
- `gmailClientFor(accountId, fetchImpl?)` → `new GmailClient({ getAccessToken:
  (force) => getAccessToken(accountId, force), fetch: fetchImpl })`.
- `refreshAliases`: `listSendAs()`; keep addresses with
  `verificationStatus === 'accepted'` or `isPrimary`, lower-cased, excluding the
  account email itself.
- `reconcileSelfContacts`: delete `contact_emails` rows whose address is a self
  address (from **any** contact), delete `source = 'gmail'` contacts left with
  no address and no opportunities, refresh the affected contacts. (A trigger
  already prevents inserting self addresses.)
- `disconnectAccount`: revoke (best effort), `stopWatch` (best effort), clear
  tokens, `status 'disconnected'`; keeps messages.
- `deleteAccount`: delete the row (messages cascade) then refresh stats for
  all contacts.
- `recordAccountError(accountId, error)` stores a short human-readable message
  (`GmailApiError`/`OAuthError` → status + message; truncate to 500 chars).

## lib/sync/locks.ts

Per the doc comments, plus: `releaseSyncLeaseIfIdle(accountId)` —
`update … set sync_locked_until = null where id = $1 and not sync_requested
returning id`; returns `false` when a request arrived (the caller loops again).

## lib/sync/backfill.ts — `runBackfillChunk(accountId, {deadline, fetchImpl})`

```
account inactive or backfill done            → skipped
acquireLease('backfill', 330 s) fails        → locked
pg_database_size() ≥ env.dbSizeLimitMb MB    → backfill_status 'error',
    last_error "Import paused: database is at N MB (limit M MB)…" → error
status → running, backfill_started_at = coalesce(...)
loop while Date.now() < deadline:
  page = listMessages({ q: account.backfill_query ?? buildBackfillQuery(...),
                        pageToken, maxResults: 100, includeSpamTrash: false })
    GmailApiError 400 (invalid page token) → restart once with pageToken = null
  skip ids already stored; getMessages(rest) (paced)
  keep messages whose fetched labels pass shouldSkipLabels; parse; ingest
  one UPDATE: page token, scanned += ids, imported += stored, estimate,
              last_error = failures summary or null; extendLease
  no nextPageToken → status 'done', completed_at, page token null; break
rate limit still exceeded after the client's retries → keep progress, return
  'progress' with error (status stays 'running')
AccountAuthError → return error (account already marked)
finally releaseLease('backfill') (after the final state UPDATE)
```

`resetBackfill`: page token null, status pending, counters kept.

## lib/sync/incremental.ts — `runIncrementalSync(accountId, {deadline, fetchImpl})`

```
account inactive                               → skipped
history_id null → set from getProfile(), last_synced_at = now → ok
acquireLease('sync', 330 s) fails → requestSync; return queued
loop:
  takeSyncRequest()
  for each history page (startHistoryId = stored history_id,
      historyTypes = messageAdded, messageDeleted, labelAdded, labelRemoved):
    fold records in order into id → action:
      messagesAdded: labels include DRAFT/CHAT/SCHEDULED → ignore; else 'upsert'
      labelsAdded SPAM                          → 'spam'
      labelsRemoved SPAM or TRASH               → 'upsert' (restored)
      labelsAdded / labelsRemoved (other)       → 'labels' (record current labelIds)
      messagesDeleted                            → 'deleted'
    apply: spam → deleteMessages; deleted → markMessagesDeleted;
           labels → updateMessageLabels;
           upsert → if stored: updateMessageLabels with the record's labels;
                    else fetch, apply shouldSkipLabels to fetched labels, ingest
           (fetch 404 → treat as deleted)
    checkpoint: history_id = greatest(history_id, max record id of the page)
    stop early if Date.now() ≥ deadline (remember "more to do")
  when all pages done: history_id = greatest(history_id, response.historyId),
                       last_synced_at = now, clear last_error
  releaseSyncLeaseIfIdle(); if false and time remains → loop again
GmailApiError 404 on history.list (history expired) → recovery:
  H0 = getProfile().historyId (FIRST)
  since = (last_synced_at ?? backfill_completed_at ?? created_at) − 1 day
  if backfill not done: backfill page token = null (it rescans from newest)
  else: backfill_status 'pending', backfill_query = base query +
        ` after:<since as epoch seconds>`, page token null
  history_id = H0; trigger backfill job; return recovered
finally release the lease if still held
out of time with more to do, or sync_requested still set → triggerAccountJob(sync)
```

## lib/sync/watch.ts

`ensureWatch`: when `env.pubsubTopic` is set, call `users.watch` with no label
filter (all changes); store `watch_expires_at`, `watch_renewed_at`; set
`history_id` only when null. Errors → `last_error` "Live sync unavailable: …",
return false. `stopWatch` best effort.

## lib/sync/drafts.ts

Implement all functions per their doc comments using new `GmailClient` methods
you add (`createDraft` exists; add `updateDraft`, `sendDraft`, `deleteDraft`,
`listDrafts`, `getDraft`). Recipients are validated (`isValidEmail`); From is
the account address with its display name; replies use the replied message's
thread (only when it belongs to the same account), `In-Reply-To` = its
`rfc822_message_id`, `References` = its `references_header`, and
`replySubject()` when no subject is given. Require `canCompose(scopes)`, else
throw a friendly "Reconnect <email> to allow drafts" error. Draft URL:
`https://mail.google.com/mail/?authuser=<email>#drafts?compose=<message id>`.
After `sendGmailDraft`, fetch the sent message and ingest it right away so it
shows in the CRM before the next sync.

## lib/sync/runner.ts

Per the doc comments. `triggerAccountJob` sends `x-crm-hop`; `runAccountJob`
chains a backfill only when it made progress, is not done and `hop <
MAX_CHAIN_HOPS`. `handlePushNotification` never trusts the payload's
historyId (it only identifies the account) and also resumes a stalled import.

## Routes (all Node runtime, `export const maxDuration = 300` where work runs)

- `GET /api/google/connect` — session required (redirect to /login). State =
  `randomToken(32)` in an httpOnly, Secure (prod), SameSite=Lax cookie
  `oauth_state`, path `/api/google`, max-age 600. Optional `?login_hint=`.
  Redirect to `buildAuthUrl`.
- `GET /api/google/callback` — session required; `error` param → redirect
  `/settings?error=access_denied|…`; state must equal the cookie (`safeEqual`),
  cookie deleted (one use) → else `/settings?error=state`; `exchangeCode`;
  `hasRequiredScopes` else `/settings?error=scopes`; profile via a temporary
  `GmailClient` using the fresh access token; aliases via `listSendAs` (best
  effort); `upsertAccountFromOAuth`; `reconcileSelfContacts`; then in `after()`:
  `ensureWatch`, and either `runBackfillChunk` directly (new account or import
  unfinished; chain with hop 1 afterwards) or `runIncrementalSync` (reconnect
  catch-up). Redirect `/settings?connected=<email>`.
- `POST /api/gmail/push` — 404 when `PUBSUB_VERIFICATION_TOKEN` is unset;
  `?token=` must match (`safeEqual`); when `PUBSUB_AUDIENCE` is set also verify
  the `Authorization: Bearer` OIDC JWT with jose `createRemoteJWKSet(new
  URL('https://www.googleapis.com/oauth2/v3/certs'))`, issuer
  `accounts.google.com`/`https://accounts.google.com`, audience, and (if set)
  `email === PUBSUB_SERVICE_ACCOUNT && email_verified`. Decode
  `message.data` (base64 JSON `{emailAddress, historyId}`); malformed → 204
  (ack, logged). `after(() => handlePushNotification(...))`; respond 204.
- `POST /api/sync/[accountId]?mode=backfill|sync` — `hasCronSecret(request)` or
  a valid session; hop from `x-crm-hop`; `after(runAccountJob)`; respond 202.
- `GET /api/cron/sync` — `hasCronSecret` else 401; `runCron`; JSON summary.
- `GET /api/accounts` — session; `{ accounts: listAccountViews(), databaseMb }`.

## Tests (vitest; Postgres integration)

Build a **fake Gmail** (`tests/helpers/fake-gmail.ts`): an in-memory mailbox
(messages with labels, history log with incrementing ids, drafts) exposed as a
`fetch` implementation for `https://gmail.googleapis.com/...` and the OAuth
token endpoint. Cover at least:

- backfill: resumes from the saved page token across chunks; skips stored ids;
  respects the deadline; marks done; excludes spam/trash/drafts/chats by
  fetched labels; DB size guard; invalid page token restart;
- incremental: adds, label changes (archive/read/star), trash (kept + label),
  permanent delete (kept + `DELETED`), spam (deleted), restore from trash/spam,
  drafts ignored, checkpointing per page, 404 → recovery sets history_id to the
  profile id **read before** listing and schedules the gap import;
- leases: concurrent run returns queued and sets `sync_requested`; the holder
  loops again; `releaseSyncLeaseIfIdle` semantics;
- contacts: auto-creation rules (outbound recipients, inbound non-automated
  sender, contact-form Reply-To, mass mail cutoff, self/no-reply exclusion),
  organization by domain, default project, names filled, no duplicate contacts
  under concurrent ingest;
- one poison message (NUL byte, huge Message-ID, invalid address) does not
  block the batch and history still advances;
- reconnect keeps `history_id`; `refresh token` not overwritten with null;
- stats: cc'd people are not "awaiting reply"; a reply in the thread clears
  `awaiting_reply_since`;
- routes: push token/OIDC rejection, callback state mismatch, `/api/sync`
  auth, cron auth (call the route handlers directly with `Request` objects;
  mock `after` from `next/server` with `vi.mock` to run the callback inline).
