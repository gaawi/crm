# Known issues (v1)

These come from the October 2026 multi-agent review. Findings that could send an
email the owner did not approve, send one twice, lose or block mail sync, or
expose data were fixed before v1 (see git history: "Fix review findings…").
What remains is listed here for the next iterations. Items marked
*unverified* were reported by a reviewer but not independently confirmed.

## Sync

- **Labels after a long disconnection**: when Gmail's history has expired
  (about a week without any sync), the gap import adds missing mail but does
  not refresh labels (archived/read/starred), spam removal or permanent
  deletions of mail that was already stored.
- **Push during lease hand-off** (rare): a push that arrives while a sync is
  finishing can wait until the next push, cron run or app visit.
- **Multipart text**: only the first plain-text part is stored; text that
  follows an inline attachment (Apple Mail) is missing from search and Claude.
- *Unverified*: contact-form notifications from senders that don't look like
  "no-reply" create one contact for the form service instead of the inquirer.

## Claude

- The confirmation card of `update_contact` does not mention that clearing the
  follow-up date also clears its note.
- A server-side model fallback in the middle of an answer can repeat part of
  it; prompt caching covers the system prompt and tools but not the growing
  conversation (cost, not correctness).
- *Unverified*: tools don't expose organization kinds (venue/funder…) or deal
  kinds, so "which venues…" questions rely on names and notes.

## Data and search (unverified)

- Very rare search terms can make global message search slow on very large
  mailboxes (full-text index not used for some query shapes); mail-client text
  search recomputes the text vector for candidate threads.
- `-word` exclusions in the mail search are treated as required words; quoted
  phrases are matched as separate words; `label:` across accounts can match
  another account's label with the same id.
- "Needs your reply" / "waiting on them" use simpler rules than the
  thread-aware `awaiting_reply_since` in some cases (Cc introductions, group
  threads answered by someone else).
- Organization correspondence includes automated mail (newsletters) from the
  organization's domains.
- Merging contacts leaves the merged contact's queued emails without a contact.
- Contact/organization history paging can repeat a message when several share
  the same timestamp.

## App (unverified)

- Pipeline deal form only lists the first 500 contacts/organizations; a double
  tap on "advance stage" can move two stages; values with a decimal comma are
  misread; deals opened from other pages return to the Pipeline.
- Editing a proposed email loses the edits if saving fails; To/Cc are
  truncated on cards.
- Contacts filters: a cleared filter can come back on the next change.
- Wide Markdown tables in Claude's answers scroll the whole page on iPhone.
- No `error.tsx`: an unexpected server error replaces the page with the
  generic error screen.
- Leaving the Claude tab mid-answer loses that answer.
- Mail: only one composer at a time; Gmail drafts open in Gmail (no in-app
  editing); after browser Back the row of a just-read thread can show as
  unread until refresh.
