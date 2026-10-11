@AGENTS.md

# Owner preferences (always)

- NEVER use em dashes (the long dash, U+2014) in anything written for the owner: replies, emails, drafts, UI copy, commit messages, reports. Use commas, periods, colons or parentheses. Claude's email paths enforce it with `noEmDash` (lib/text/no-em-dash.ts) and `NO_EM_DASH_RULE` in every prompt.
