# CRM

A private CRM built on your Gmail accounts, for an arts producer: bookings
with venues (concert halls, chamber music halls, theaters, festivals), private
fundraising, partners, press and grants.

- **Every Gmail account in one place.** Connect several accounts with OAuth.
  Past mail is imported, then kept in sync live (Pub/Sub push plus Gmail
  history). Each message records which account it came from.
- **Contacts appear by themselves.** People are matched by email address, and
  one person's history is merged across all their addresses and all your
  accounts.
- **Contacts:** organization, role, notes, tags, projects (CreArtBox, ADAR,
  Personal, Booking, Press, Grants, Fundraising, Partners…), status, follow-up
  date and note, last contact, and the full email history.
- **Organizations** (venues, funders, partners, press…), each with its people,
  deals and all correspondence.
- **Pipeline:** deals by stage, per kind (booking, fundraising, partnership,
  grant, press).
- **Today:** follow-ups due, people waiting for your reply, people you're
  waiting on, and what's coming up.
- **Approvals:**
  - Claude prepares emails, which also appear as real Gmail drafts.
  - You approve one with two taps, edit it, or leave a note ("shorter", "mention
    Oct 12") and Claude rewrites it.
  - **Nothing is sent without your approval.**
  - The optional daily autopilot drafts replies, due follow-ups and nudges.
- **Claude assistant.** Ask things like "Who haven't I followed up with?",
  "When did I last write to Anna?", "Show me everything with the Harbor Arts
  Foundation", "Draft a follow-up to Tom" or "Who's interested in ADAR?".
  Claude answers from the CRM, and changes need your tap to confirm.
- **Mail:** a Gmail-style client (inbox tabs, labels, search with Gmail
  operators, archive, star, reply, compose) with the CRM and Claude alongside
  every conversation.
- **iPhone:** a real app feel, with a tab bar, large titles, swipe actions and
  full-screen sheets. Add it to the Home Screen.
- **Private by design.**
  - One owner, one password.
  - Gmail tokens are encrypted.
  - No tracking pixels, and email images from other servers are never loaded.
  - HTML email is shown in a sandbox that can't run code.

## Stack

- Next.js 16 on Vercel
- Supabase Postgres
- Gmail API with OAuth (`gmail.modify`: read, labels, drafts and send, never
  permanent deletion)
- Google Pub/Sub
- Claude API

## Docs

- [docs/SETUP.md](docs/SETUP.md): deploy it (Supabase, Google Cloud, Vercel).
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): decisions, data model, screens,
  roadmap.
- [docs/SYNC_SPEC.md](docs/SYNC_SPEC.md) and
  [docs/MAIL_CLIENT_SPEC.md](docs/MAIL_CLIENT_SPEC.md): detailed specs.
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md): run it locally, tests,
  conventions.

## Quick start (local)

```bash
npm install
cp .env.example .env.local   # DATABASE_URL, APP_PASSWORD, SESSION_SECRET, TOKEN_ENCRYPTION_KEY…
npm run db:migrate
node scripts/seed-demo.mjs   # optional: fictional demo data (local databases only)
npm run dev
```

## Tests

```bash
npm test                     # unit + Postgres integration tests (in-memory fake Gmail)
SKIP_DB_TESTS=1 npm test     # unit tests only
```
