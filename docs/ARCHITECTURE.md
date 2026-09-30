# CRM — MVP architecture

A private, single-owner CRM that turns several Gmail mailboxes into one
contact history, with a small pipeline and a Claude assistant on top.

```
                ┌──────────────── Vercel (Next.js 16, Node runtime) ────────────────┐
 Browser ──────▶│  App Router pages (server components) + server actions            │
 (password      │  /api/google/*      OAuth connect + callback                      │
  session)      │  /api/gmail/push    Pub/Sub push endpoint  ──┐                    │
                │  /api/sync/[id]     run one import/sync chunk │ after() / chain   │
                │  /api/cron/sync     daily catch-up + watch renewal (Vercel Cron)  │
                │  /api/assistant     Claude chat, streamed (tool use over the CRM) │
                │  /api/mcp           same tools as an MCP server (optional)        │
                └───────┬───────────────────────┬───────────────────────┬───────────┘
                        │ postgres.js           │ fetch                 │ @anthropic-ai/sdk
                        ▼                       ▼                       ▼
              Supabase Postgres        Gmail API + OAuth         Claude API
              (DATABASE_URL,           users.watch ─▶ Google Pub/Sub topic
               transaction pooler)                     └─ push subscription ─▶ /api/gmail/push
```

## Decisions (and why they are the simplest thing that works)

| Concern | Choice |
|---|---|
| Tenancy | Single owner. No `user_id` columns. |
| App login | One password (`APP_PASSWORD`) → signed JWT cookie (`jose`, 30 days). Checked in `proxy.ts`. |
| DB access | `postgres` (porsager) over Supabase's **transaction pooler** (`prepare: false`). All SQL runs on the server; RLS is enabled with no policies so the public Supabase API exposes nothing. |
| Gmail access | Plain `fetch` against the Gmail REST API (no `googleapis` dependency). Scopes: `gmail.readonly` (sync) + `gmail.compose` (save drafts only; the app never sends). |
| Token storage | Refresh/access tokens encrypted with AES-256-GCM (`TOKEN_ENCRYPTION_KEY`). |
| Initial import | Resumable chunks of `messages.list` pages with a saved page token. Each chunk runs inside `after()` and triggers the next chunk with an authenticated self-request, so the import keeps going after you close the tab. The daily cron and the Settings page can resume a stalled import. |
| Live sync | `users.watch` → Pub/Sub → `/api/gmail/push` → `history.list` from the stored `history_id`. A lease lock per account plus a `sync_requested` flag coalesces bursts of notifications. If the history id has expired (404), re-list recent mail by date. |
| Scheduler | Vercel Cron once a day (Hobby-compatible): renew watches (7-day expiry), catch-up sync, resume imports. |
| Contacts | Linked to mail **by address** (`message_participants.email = contact_emails.email`). A contact can own many addresses → histories merge across addresses and accounts. Merge = move addresses. |
| Dedup across accounts | One `messages` row per (account, Gmail id). Views de-duplicate on the RFC 822 `Message-ID` and show every account that saw the message. |
| Search | Postgres full-text search (`messages.search` generated `tsvector`, GIN index). |
| Claude | Claude API with a manual streaming tool loop. Tools wrap the same query functions the UI uses, plus a read-only SQL tool. Draft follow-ups use structured output and can be saved as Gmail drafts. |
| UI | Tailwind v4 with a handful of hand-written primitives; light/dark via CSS variables. No component library. |
| Tracking pixels | None. The app never sends mail. |

## Data model

See `supabase/migrations/20260930000000_init.sql` (commented). Tables:

- **gmail_accounts** — connected mailboxes, encrypted tokens, sync cursors
  (`history_id`, `backfill_page_token`), lease locks, watch expiry, errors.
- **organizations** — name (unique, case-insensitive), `domains[]` for
  auto-linking new contacts, website, notes, tags.
- **projects** — seeded with CreArtBox, ADAR, Personal, Booking, Press, Grants.
- **contacts** — name, organization, role, notes, tags[], status
  (`new | lead | active | inactive | archived`), follow-up date + note, and
  denormalized `last_contacted_at / last_inbound_at / last_outbound_at /
  message_count` maintained by `refresh_contact_stats()`.
- **contact_emails** — address → contact (PK on address; one primary per contact).
- **contact_projects** — many-to-many contacts ↔ projects.
- **messages** — one per Gmail message per account: ids, thread, RFC 822 ids,
  direction (`SENT` label ⇒ outbound), from, subject, snippet, stripped plain
  text body (null for automated mail), labels, attachments metadata, FTS vector.
- **message_participants** — (message, role, address, display name).
- **opportunities** — pipeline items: stage
  (`lead → contacted → proposal → negotiation → won | lost`), contact,
  organization, project, value, follow-up date, next step, notes.

SQL functions: `refresh_contact_stats(uuid[])`, `merge_contacts(target, source)`.

### Derived views of the data

- **Complete history of a contact** = messages having a participant whose address
  belongs to the contact, de-duplicated by `coalesce(rfc822_message_id, id)`.
- **Organization correspondence** = union of its contacts' histories.
- **Follow-ups** (the "Today" page and the `list_follow_ups` tool):
  - *Due*: `contacts.follow_up_at <= today` or `opportunities.follow_up_at <= today`
    (open stages), excluding archived contacts.
  - *Needs reply*: `last_inbound_at > coalesce(last_outbound_at, -∞)` — they
    wrote last.
  - *Awaiting reply*: `last_outbound_at > coalesce(last_inbound_at, -∞)` and older
    than 7 days — you wrote last and heard nothing.
  - Both reply lists ignore contacts whose `reply_dismissed_at` is newer than
    their last message ("Mark done"), archived contacts, and mail older than 90 days.
- "Today" is computed in `APP_TIMEZONE` (default `America/New_York`).

## Gmail sync

### What is imported

Everything except spam, trash, drafts, chats and (by default) the Promotions
and Social categories (`SYNC_SKIP_CATEGORIES`, default `promotions,social`). The
same rule is applied to the historical import (as a Gmail search query) and to
live sync (by label ids), so both paths agree. `GMAIL_BACKFILL_QUERY` can narrow
the import further (e.g. `after:2021/01/01`).

A message that is later trashed/spammed or deleted in Gmail is removed from the
CRM; if it is restored it is imported again.

### Parsing (`lib/gmail/parse.ts`)

- Headers: From, To, Cc, Bcc (sent mail), Subject, Message-ID, In-Reply-To,
  References, List-Unsubscribe, List-Id, Precedence, Auto-Submitted. RFC 2047
  encoded words are decoded. Address lists are parsed with a quote/comment-aware
  RFC 5322 parser; addresses are lower-cased.
- `sent_at` = Gmail `internalDate`.
- Body: prefer `text/plain`; otherwise convert `text/html` to text. Quoted
  replies (`On … wrote:`, `>` lines, Outlook `From:/Sent:` blocks, `-----Original
  Message-----`) are stripped; capped at 20 000 characters.
- `is_automated` when any of: List-Unsubscribe / List-Id header, Precedence
  bulk|list|junk, Auto-Submitted ≠ no, Gmail category Promotions / Social /
  Updates / Forums, or a no-reply style sender (`noreply@`, `mailer-daemon@`, …).
  Automated inbound mail is stored with snippet only (no body).

### Contact matching and auto-creation (`lib/sync/rules.ts`, `lib/sync/ingest.ts`)

Own addresses (all connected accounts + their send-as aliases) never become
contacts. For every stored message:

- **Outbound**: every To/Cc/Bcc recipient becomes a contact if unknown — unless
  the message has more than 20 recipients (mass mail).
- **Inbound, not automated**: the sender becomes a contact if unknown.
- Everyone else is still stored as a participant; if they later become a contact
  (manually or by an outbound email) their older messages show up instantly,
  because matching is by address at read time.

New contacts get `status = new`, `source = gmail`, the display name from the
header, and the organization whose `domains` contains the address's domain
(free-mail domains such as gmail.com are never matched). A contact whose name is
empty picks up a display name the next time one appears.

Creation is serialized with a transaction-level advisory lock so concurrent
imports never create two contacts for one address. After each batch,
`refresh_contact_stats()` runs for the affected contacts.

### Initial import (`lib/sync/backfill.ts`)

```
connect ─▶ store tokens, profile.historyId as history_id (live sync starts here)
        ─▶ users.watch (if GMAIL_PUBSUB_TOPIC is set)
        ─▶ POST /api/sync/{id}?mode=backfill  (202, work continues in after())

chunk:  take backfill lease lock (else stop)
        loop until the time budget is used:
          messages.list(q, pageToken, 100 ids)
          skip ids already stored; messages.get(format=full) × 8 in parallel
          parse → ingest; save next page token + counters
        no next page ⇒ backfill_status = done
        made progress and not done ⇒ POST /api/sync/{id}?mode=backfill again
```

History captured at connect time guarantees nothing arriving during the import
is missed; overlaps are harmless because ingestion is an upsert on
`(account_id, gmail_message_id)`.

### Live sync (`lib/sync/incremental.ts`)

```
push/cron/manual ─▶ take sync lease lock; if held: set sync_requested and return
  repeat:
    clear sync_requested
    history.list(startHistoryId = history_id, types = messageAdded,
                 messageDeleted, labelAdded, labelRemoved) — all pages
    fold records in order into { id → upsert | delete }
      (TRASH/SPAM added ⇒ delete; removed ⇒ upsert; DRAFT/CHAT/skipped
       categories ⇒ ignore)
    delete rows; fetch + ingest new ids
    history_id = greatest(history_id, response.historyId)
  while sync_requested was set again and time remains
  404 (history too old) ⇒ list messages newer than last_synced_at − 1 day,
                          ingest, set history_id from getProfile
release lock
```

The push handler answers 204 immediately and runs the sync in `after()`.
Pub/Sub retries are harmless (idempotent). The daily cron renews every watch
that expires within 48 hours and runs the same catch-up sync.

Gmail API calls retry with exponential backoff on 429, 5xx and
`rateLimitExceeded`/`userRateLimitExceeded`. An `invalid_grant` on token refresh
marks the account `reauth_required` and stops its sync until reconnected.

## Claude

`lib/ai/tools.ts` defines tools once (zod schemas + handlers). They are used by
the in-app assistant (`/api/assistant`) and the optional MCP endpoint
(`/api/mcp`, bearer `MCP_API_KEY`), so Claude Desktop / Claude Code can query the
CRM too.

| Tool | Purpose |
|---|---|
| `search_contacts` | by text, project, tag, status, organization |
| `get_contact` | profile, addresses, projects, opportunities, last contact, recent emails |
| `get_correspondence` | full history with a contact or an organization (bodies included) |
| `search_emails` | full-text search over all synced mail |
| `list_follow_ups` | due, needs-reply, awaiting-reply, pipeline follow-ups |
| `get_organization` | organization, its contacts and recent correspondence |
| `list_opportunities` | pipeline by stage / project / contact / organization |
| `find_people_for_project` | project members + people whose emails mention it |
| `query_database` | read-only SQL (5 s timeout, 200 rows) for anything else |
| `update_contact` | set follow-up date/note, status, tags, projects, append a note |
| `create_gmail_draft` | save a draft in the right Gmail account (never sends) |

The assistant streams NDJSON events (`text`, `tool`, `done`, `error`) to the
browser. Email content is treated as untrusted data in the system prompt.
"Draft follow-up" on a contact page is a single structured-output call using the
last messages with that person, their notes, projects and open opportunities;
the result is editable and can be saved as a Gmail draft (as a reply in the
latest thread, from the account that last corresponded with them).

Model: `ANTHROPIC_MODEL` (default `claude-opus-5-5`), adaptive thinking, explicit
effort, server-side refusal fallback (`fallbacks: "default"`).

## Pages

| Route | Content |
|---|---|
| `/` Today | Follow-ups due, needs reply, awaiting reply, pipeline follow-ups, recent activity |
| `/contacts` | Search + filters (project, tag, status), sorted by last contact |
| `/contacts/[id]` | Profile (inline edit), addresses, projects, tags, follow-up, opportunities, merged email timeline with account badges, Draft follow-up, Merge |
| `/organizations`, `/organizations/[id]` | Organizations; contacts + all correspondence |
| `/projects`, `/projects/[id]` | Projects; people + opportunities per project |
| `/pipeline` | Opportunities as columns by stage |
| `/assistant` | Chat with Claude over the CRM |
| `/search?q=` | Contacts, organizations and emails |
| `/settings` | Gmail accounts (connect, import progress, sync status, disconnect), projects |
| `/login` | Password |

## Code layout

```
app/                    routes (see above) + api/*
components/             UI primitives and feature components
lib/env.ts              typed, lazy environment access
lib/db.ts               postgres.js client
lib/auth.ts             session cookie (jose)
lib/crypto.ts           AES-256-GCM helpers
lib/dates.ts            timezone-aware "today" + formatting
lib/types.ts            domain types shared by UI, queries and tools
lib/gmail/              OAuth, REST client, parsing, MIME drafts
lib/sync/               accounts, ingestion, rules, backfill, incremental, watch, runner
lib/queries/            read/write functions used by pages, actions and Claude tools
lib/ai/                 Claude client, tools, assistant loop, draft generation
supabase/migrations/    SQL
tests/                  vitest (unit + Postgres integration)
```

## Environment

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Supabase pooler URI, port 6543 |
| `APP_URL` | yes | e.g. `https://crm.example.com` (OAuth redirect + self-requests) |
| `APP_PASSWORD` | yes | login password |
| `SESSION_SECRET` | yes | ≥ 32 random chars |
| `TOKEN_ENCRYPTION_KEY` | yes | 32 random bytes, base64 |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | yes | OAuth web client |
| `CRON_SECRET` | yes | Vercel Cron + internal self-requests |
| `ANTHROPIC_API_KEY` | yes | Claude |
| `GMAIL_PUBSUB_TOPIC` | recommended | `projects/<gcp-project>/topics/<topic>` |
| `PUBSUB_VERIFICATION_TOKEN` | with topic | shared secret in the push URL |
| `ANTHROPIC_MODEL` | no | default `claude-opus-5-5` |
| `MCP_API_KEY` | no | enables `/api/mcp` |
| `APP_TIMEZONE` | no | default `America/New_York` |
| `SYNC_SKIP_CATEGORIES` | no | default `promotions,social` |
| `GMAIL_BACKFILL_QUERY` | no | extra Gmail query for the first import |
