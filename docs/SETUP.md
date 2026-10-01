# Setup: Supabase + Google Cloud + Vercel

About 30 minutes, done once. You need: a Supabase project, a Google Cloud
project (free), a Vercel account, and an Anthropic API key.

**Plans.** Supabase Free (500 MB) holds a few years of mail for a couple of
accounts — bodies are stored as trimmed plain text and the import pauses at
`DB_SIZE_LIMIT_MB` (450 by default) before Supabase would turn the database
read-only; Settings shows the usage. With many or very large mailboxes use
Supabase Pro (8 GB) and raise `DB_SIZE_LIMIT_MB`. Vercel Hobby works for
personal use (daily cron → add the Supabase scheduler in step 6); Vercel's
terms require **Pro** for commercial use, which also allows frequent cron.

## 1. Database (Supabase)

1. Create a project (region close to you, e.g. `us-east-1` for New York).
2. **Project Settings → Database → Connection string → Transaction pooler**.
   Copy the URI (port **6543**) and put your database password in it. This is
   `DATABASE_URL`.
3. Apply the schema, either:
   - `DATABASE_URL=... npm run db:migrate` from your machine, or
   - paste `supabase/migrations/20260930000000_init.sql` into the Supabase SQL
     editor and run it.

Row Level Security is on for every table with no policies, and the `anon` /
`authenticated` roles have no privileges, so the public Supabase API cannot
read anything. The app only talks to Postgres directly from the server.

Claude's free-form SQL tool needs a SELECT-only role that cannot read the
Gmail tokens: run `supabase/optional/readonly-role.sql` (set a password
first) and put its connection string in `DATABASE_READONLY_URL`
(`postgresql://crm_reader.<project-ref>:<password>@…pooler.supabase.com:6543/postgres`).
Without it the SQL tool is simply not offered to Claude; every other tool
works.

## 2. Google Cloud: OAuth client + Gmail API

In <https://console.cloud.google.com> create (or pick) a project, then:

1. **APIs & Services → Library**: enable **Gmail API** and **Cloud Pub/Sub API**.
2. **Google Auth Platform → Branding / Audience** (OAuth consent screen):
   - User type **External** (works for Gmail and Workspace addresses).
   - App name, support email, developer email.
   - **Audience → Publish app** so the status is **In production**.
     ⚠️ In "Testing" status Google expires refresh tokens after **7 days**, which
     would disconnect every mailbox weekly. You do not need Google's
     verification for personal use (fewer than 100 users you know): each time
     you connect a mailbox you will see "Google hasn't verified this app" →
     **Advanced → Go to … (unsafe)**. That is expected for a private tool.
3. **Data Access → Add scopes**: `…/auth/gmail.modify` (plus `openid`,
   `email`, `profile`). One scope covers reading, labels (archive, read,
   star), drafts and sending — never permanent deletion — so mailboxes never
   need to re-consent when features are added.
4. **Clients → Create client → Web application**:
   - Authorized redirect URIs:
     - `https://YOUR-APP.vercel.app/api/google/callback`
     - `http://localhost:3000/api/google/callback` (local development)
   - Copy the **Client ID** and **Client secret** → `GOOGLE_CLIENT_ID`,
     `GOOGLE_CLIENT_SECRET`.

**Google Workspace mailboxes** (e.g. `@creartbox.nyc`): if the Workspace admin
restricts third-party apps, allow this one in **Admin console → Security → API
controls → App access control → Configure new app** (search by client ID) and
mark it *Trusted*.

## 3. Google Cloud: Pub/Sub for instant sync

```bash
PROJECT=your-gcp-project-id
APP=https://YOUR-APP.vercel.app
TOKEN=$(openssl rand -hex 24)         # → PUBSUB_VERIFICATION_TOKEN

gcloud config set project $PROJECT
gcloud pubsub topics create gmail-crm

# Let Gmail publish to the topic
gcloud pubsub topics add-iam-policy-binding gmail-crm \
  --member=serviceAccount:gmail-api-push@system.gserviceaccount.com \
  --role=roles/pubsub.publisher

# Push every notification to the app
gcloud pubsub subscriptions create gmail-crm-push \
  --topic=gmail-crm \
  --push-endpoint="$APP/api/gmail/push?token=$TOKEN" \
  --ack-deadline=60 \
  --min-retry-delay=10s --max-retry-delay=600s
```

Set `GMAIL_PUBSUB_TOPIC=projects/$PROJECT/topics/gmail-crm` and
`PUBSUB_VERIFICATION_TOKEN=$TOKEN`.

Optional, stronger authentication: create a service account
(`gcloud iam service-accounts create gmail-crm-push`), add
`--push-auth-service-account=gmail-crm-push@$PROJECT.iam.gserviceaccount.com
--push-auth-token-audience=$APP/api/gmail/push` to the subscription, and set
`PUBSUB_SERVICE_ACCOUNT` / `PUBSUB_AUDIENCE` to the same values. The app then
also verifies Google's signed token on every push.

If the IAM binding fails with a *domain restricted sharing* error (common in
Google Cloud projects owned by a Workspace organization), an org admin must
allow the `system.gserviceaccount.com` domain in the
`iam.allowedPolicyMemberDomains` organization policy for this project — or use
a project outside the organization.

Without Pub/Sub the app still works: it syncs when you open the app, when you
press **Sync now**, and on every scheduler run (step 6).

## 4. Vercel

1. Import the Git repository in Vercel (framework: Next.js, defaults are fine).
2. **Settings → Environment Variables** (Production), from `.env.example`:

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | Supabase transaction pooler URI |
   | `APP_URL` | `https://YOUR-APP.vercel.app` (your production domain) |
   | `APP_PASSWORD` | the password you will sign in with (at least 12 characters; changing it signs out every device) |
   | `SESSION_SECRET` | `openssl rand -base64 48` |
   | `TOKEN_ENCRYPTION_KEY` | `openssl rand -base64 32` — keep it; changing it disconnects all mailboxes |
   | `CRON_SECRET` | `openssl rand -hex 32` |
   | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | from step 2 |
   | `GMAIL_PUBSUB_TOPIC`, `PUBSUB_VERIFICATION_TOKEN` | from step 3 |
   | `ANTHROPIC_API_KEY` | from console.anthropic.com |
   | `DATABASE_READONLY_URL` | the SELECT-only role from step 1 (optional, enables Claude's SQL tool) |

3. Deploy. `vercel.json` registers a daily cron (`/api/cron/sync`) that renews
   Gmail watches, continues imports, catches up anything missed and runs the
   autopilot. On the Pro plan make it more frequent (e.g. `*/10 * * * *`), or
   use the Supabase scheduler (step 6).
4. Keep Deployment Protection off for the **production** domain (Pub/Sub, the
   cron job and the import's self-requests must reach it). Preview deployments
   can stay protected.

## 5. First run

1. Open the app, sign in with `APP_PASSWORD`.
2. **Settings → Connect Gmail account**, pick the Google account, accept.
   The historical import starts immediately and continues in the background
   (roughly 1,000 messages per 5 minutes per account, paced to stay within
   Gmail's quota). You can connect the next account right away.
3. Review auto-created contacts (status **New**) as they appear: archive noise,
   merge duplicates, assign organizations and projects.

## 6. Scheduler (recommended on Vercel Hobby)

Vercel Hobby runs cron once a day. To keep imports moving and the autopilot
on time, let Supabase call the endpoint every 5 minutes: edit the URL and
`CRON_SECRET` in `supabase/optional/scheduler.sql` and run it in the SQL
editor (uses the `pg_cron` and `pg_net` extensions; `select
cron.unschedule('crm-sync')` removes it).

## Optional: Claude Code (MCP)

The same CRM tools Claude uses in the app are available to Claude Code over
MCP. Set `MCP_API_KEY` (e.g. `openssl rand -hex 32`) and redeploy, then:

```bash
claude mcp add --transport http crm https://YOUR-APP.vercel.app/api/mcp \
  --header "Authorization: Bearer $MCP_API_KEY"
```
