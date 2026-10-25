@AGENTS.md

# Owner preferences (always)

- NEVER use em dashes (the long dash, U+2014) in anything written for the owner: replies, emails, drafts, UI copy, commit messages, reports. Use commas, periods, colons or parentheses. Claude's email paths enforce it with `noEmDash` (lib/text/no-em-dash.ts) and `NO_EM_DASH_RULE` in every prompt.
- ChatGPT does work for the owner straight in the Supabase database (it cannot use the app). Whenever a change adds or renames a field ChatGPT should fill, tell the owner in the reply exactly which table and column it goes in (e.g. `listing_submissions.pending_reason`), how to find the row's ids, and put that instruction in a Postgres `comment on column` so ChatGPT can read it from the schema.
