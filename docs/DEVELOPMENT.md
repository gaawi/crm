# Development

## Requirements

- Node 20.9+ (22 recommended)
- PostgreSQL 15+ locally for tests (or any reachable database)

## First run

```bash
npm install
cp .env.example .env.local        # fill in at least DATABASE_URL, APP_PASSWORD, SESSION_SECRET, TOKEN_ENCRYPTION_KEY
npm run db:migrate                # applies supabase/migrations/*.sql
npm run dev                       # http://localhost:3000
```

For Gmail OAuth locally, add `http://localhost:3000/api/google/callback` as an
authorized redirect URI of the OAuth client. Push notifications need a public
URL, so locally use **Settings → Sync now** instead (or a tunnel).

## Tests

```bash
npm test                  # unit + Postgres integration tests
SKIP_DB_TESTS=1 npm test  # unit tests only
```

Integration tests recreate the database named in `TEST_DATABASE_URL`
(default `postgres://postgres:postgres@localhost:5432/crm_test`) from the
migrations on every run.

## Checks

```bash
npm run typecheck
npm run lint
npm run build
```

## Conventions

- All database access is server-side through `lib/db.ts` (`sql` tagged
  templates, camelCase results, `::int` on counts, dates as `YYYY-MM-DD`).
- Pages under `app/(app)` are always dynamic (`connection()` in the layout) and
  re-check the session; server actions call `requireSession()` first and
  `refresh()`/`revalidatePath()` after mutating.
- `lib/queries/*` is the single read/write layer used by pages, actions and
  Claude tools.
- Next.js 16 specifics are summarized in `docs/NEXT16_NOTES.md`.
