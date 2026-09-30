# CRM — architecture

A private, single-owner CRM that turns several Gmail mailboxes into one
contact history for an arts producer (bookings with venues — concert halls,
chamber music halls, theaters, festivals —, private fundraising, partners,
press, grants), with a pipeline, an approval queue where Claude prepares
emails, a Gmail-style mail client, and an iPhone-first mobile experience.

```
              ┌──────────────────── Vercel (Next.js 16, Node runtime) ─────────────────────┐
 Browser /    │ pages (server components) + server actions                                  │
 iPhone PWA ─▶│ /api/google/connect|callback   OAuth                                        │
 (password)   │ /api/gmail/push                Pub/Sub push → live sync                     │
              │ /api/sync/[id]                 one import / sync job (≤ 300 s, after())     │
              │ /api/cron/sync                 renew watches, fan out jobs, autopilot       │
              │ /api/assistant                 Claude chat (NDJSON stream, tool use)        │
              │ /api/mcp                       same tools for Claude Code (optional)        │
              └───────┬──────────────────────────┬───────────────────────────┬─────────────┘
                      │ postgres.js (pooler)     │ fetch                     │ @anthropic-ai/sdk
                      ▼                          ▼                           ▼
             Supabase Postgres          Gmail API + OAuth               Claude API
             (+ optional pg_cron        users.watch ─▶ Pub/Sub topic
              scheduler)                 push subscription ─▶ /api/gmail/push
```

Detailed specs: `docs/SYNC_SPEC.md` (sync engine), `docs/MAIL_CLIENT_SPEC.md`
(mail client), `docs/NEXT16_NOTES.md` (framework notes), `docs/SETUP.md`
(deployment), `docs/DEVELOPMENT.md` (local work).

## Decisions

| Concern | Choice |
|---|---|
| Tenancy | Single owner, no `user_id` columns. |
| Login | One password (`APP_PASSWORD`, ≥ 12 chars) → signed JWT cookie (jose). Throttled per IP and globally (`login_attempts`). `proxy.ts` gates pages; every page, action and route re-checks. |
| Database | `postgres` (porsager) over Supabase's transaction pooler (`prepare: false`). RLS on with no policies: the public Supabase API exposes nothing; the app connects as the table owner. |
| Gmail access | Plain `fetch` to the Gmail REST API. One scope, `gmail.modify`: read, drafts, send, labels — never permanent deletion. Requested once so accounts never need re-consent for new features. |
| Tokens | AES-256-GCM (`TOKEN_ENCRYPTION_KEY`). |
| Quota | Gmail allows 6,000 units/min/user (`messages.get` = 20): the client paces requests (4/s) and waits out rate limits. |
| Initial import | Resumable chunks (`messages.list` page token), ≤ 300 s each, newest mail first. Chains of self-requests are capped at 3 hops (Vercel blocks long self-call chains); the cron, Pub/Sub pushes, page visits and the open Settings page start fresh chains. A database-size guard pauses the import before Supabase Free (500 MB) turns read-only. |
| Live sync | `users.watch` → Pub/Sub → `/api/gmail/push` → `history.list` from the stored cursor (checkpointed per page, only moves forward). Lease locks + `sync_requested` coalesce bursts. Expired history → re-list the gap by date through the import machinery (profile history id read first). |
| What is kept | Every message except spam, drafts and chats. Trashed / deleted mail stays in the CRM history (labels updated); spam is removed. Promotions/Social are kept but flagged automated. |
| Contacts | Linked to mail **by address** (`message_participants.email = contact_emails.email`), so history merges across addresses and accounts; merging = moving addresses. Own addresses (accounts, aliases, `OWN_EMAILS`) can never be contacts (trigger). |
| Auto-creation | Outbound recipients (≤ 20), inbound non-automated senders, and contact-form submitters (no-reply sender + real Reply-To). New contacts are `status new`, linked to the organization owning their domain, and added to the mailbox's default project. |
| Follow-up signals | Only direct exchanges count (From / Reply-To inbound, To outbound): cc'd people are never "waiting". `awaiting_reply_since` is thread-aware. Automated mail counts only when it is a marketing-tool reply inside a thread where the owner wrote. |
| Search | Postgres FTS on an expression index (no stored vector): English stemming OR exact words. |
| Approval queue | Claude (chat, contact page, autopilot) proposes emails into `email_drafts` + a real Gmail draft. The owner approves (sent via `drafts.send`, two-tap), edits, or leaves a note and Claude rewrites it. Nothing is ever sent without approval. |
| Autopilot | Optional, daily: drafts replies for people waiting, due follow-ups and nudges into the queue (max per run, never two open proposals per person). |
| Claude | Manual streaming tool loop (Opus 5.5 by default, adaptive thinking, explicit effort, server-side refusal fallback). Tools wrap the query layer; `update_contact` needs a tap to confirm; `propose_email` only queues and only to the contact or thread participants; read-only SQL runs in an always-rolled-back READ ONLY transaction on the extended protocol (optionally as a SELECT-only role). Email content is treated as untrusted data. |
| Browser safety | CSP: only the app's own origin; no remote images anywhere (no tracking pixels, no exfiltration through image links); Claude's Markdown renders without images. HTML email renders in a sandboxed iframe without scripts. |
| Mobile | iPhone-first PWA: bottom tab bar, large titles, 44 pt targets, 16 px inputs, safe areas, segmented controls, full-screen sheets, swipe actions in Mail; installable to the Home Screen. |
| Scheduler | Vercel Cron (daily on Hobby; more often on Pro) and/or Supabase pg_cron every 5 minutes (`supabase/optional/scheduler.sql`). |

## Data model (`supabase/migrations/20260930000000_init.sql`)

- **gmail_accounts** — mailboxes, encrypted tokens, scopes, aliases, default
  project, sync cursors, leases, watch state, import progress, last error.
- **organizations** — name, kind (`venue | funder | partner | press | agency |
  institution | other`), city, domains, website, notes, tags.
- **projects** — CreArtBox, ADAR, Personal, Booking, Press, Grants,
  Fundraising, Partners (editable).
- **contacts** — name, organization, role, notes, tags, status (`new | lead |
  active | inactive | archived`), follow-up date + note, source, denormalized
  history stats (`last_contacted_at`, `last_inbound_at`, `last_outbound_at`,
  `awaiting_reply_since`, `message_count`), `reply_dismissed_at`.
- **contact_emails**, **contact_projects**.
- **messages** — one row per Gmail message per account (ids, thread, RFC 822
  ids, direction, sender, subject, snippet, stripped body, labels, automated
  flag + reason, attachments metadata); **message_participants** (from, to,
  cc, bcc, reply_to).
- **opportunities** — kind (`booking | fundraising | partnership | grant |
  press | sale | other`), stage (`lead → contacted → proposal → negotiation →
  won | lost`, labelled per kind, e.g. booking: Offer sent / Confirmed),
  contact, organization, project, value, follow-up, next step, notes.
- **email_drafts** — the approval queue (status, recipients, subject, body,
  rationale, revisions, Gmail draft id, errors).
- **app_settings** — writing profile (name, signature, style) and autopilot.
- **login_attempts**; view **self_addresses**.
- Functions: `refresh_contact_stats`, `merge_contacts`,
  `message_search_vector`, `message_search_query`.

## Screens

| Route | Content |
|---|---|
| `/` Today | Follow-ups due (people + deals), needs your reply, waiting on them, coming up, recent email |
| `/mail` | Gmail-style client (see MAIL_CLIENT_SPEC) |
| `/approvals`, `/approvals/[id]` | Emails prepared by Claude: approve & send, edit, "change…" with a note, discard |
| `/contacts`, `/contacts/[id]`, `/contacts/new` | Directory with filters and triage of new contacts; contact page with merged email history, details, deals, "Draft with Claude", merge |
| `/organizations`, `/organizations/[id]` | Venues, funders, partners, press…; people, deals, all correspondence |
| `/projects`, `/projects/[id]` | People, "mentioned this project in email", deals |
| `/pipeline` | Deals by stage, per kind (booking, fundraising, …) |
| `/assistant` | Chat with Claude over the CRM |
| `/settings` | Gmail accounts, import progress, default project per mailbox, writing profile, autopilot, database usage |
| `/more`, `/search` | Phone "More" tab; global search |

## Roadmap

1. **Now**: CRM, sync, approval queue, autopilot, assistant, mobile shell.
2. **Mail client** (docs/MAIL_CLIENT_SPEC.md).
3. **Claude in charge**: prospecting — Claude researches new venues, funders
   and partners on the web (server-side web search tool) and proposes them as
   leads with sources; outreach sequences; weekly briefing.
