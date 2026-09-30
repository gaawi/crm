# Mail client ("Gmail, on steroids") — spec

A near-exact Gmail experience for every connected account, inside the CRM,
plus CRM context and Claude. Desktop mirrors Gmail's web layout; the phone
mirrors the iPhone Mail app.

## Data sources

- **Lists (inbox, labels, search results)** come from the synced `messages`
  table: fast, unified across accounts, and enriched with CRM data. Labels are
  kept current by live sync (`label_ids`, see docs/SYNC_SPEC.md; `TRASH` rows
  stay, permanently deleted ones carry the `DELETED` pseudo-label).
- **Opening a thread** fetches it live from Gmail (`threads.get`,
  `format=full`) so the full HTML, every attachment and the current labels are
  shown; if Gmail is unreachable, fall back to the stored plain-text bodies.
- **Actions** (archive, trash, read/unread, star, labels) call Gmail
  (`threads.modify` / `messages.batchModify`) and then update `label_ids` in
  the database immediately so the UI is consistent before the next sync.
- **Sending** uses `messages.send` (raw MIME from `lib/gmail/mime.ts`, with
  `threadId`, `In-Reply-To` and `References` for replies); the sent message is
  fetched and ingested right away.
- **User labels**: `labels.list` per account, fetched live (cheap) and cached
  for the request.

## Views

| View | Rule (a thread matches if any of its messages match) |
|---|---|
| Inbox | `INBOX`; tabs Primary / Promotions / Social / Updates / Forums from `CATEGORY_*` (Primary = none of the others) |
| Starred | `STARRED` |
| Sent | `SENT` |
| Drafts | live `drafts.list` (not synced) |
| All mail | everything except `TRASH`, `SPAM`, `DELETED` |
| Trash | `TRASH` |
| Label | the user label id |

Threads are keyed by `(account_id, gmail_thread_id)` and ordered by their
latest message. Row data: participants (display names, "me" for self), subject,
snippet of the latest message, message count, unread (any `UNREAD`), starred,
has attachments, labels, account. Pagination: 50 per page, cursor on the latest
message date.

The account filter ("All inboxes" or one account) applies to every view.
Unread counts per view/account are shown in the sidebar.

## Desktop (≥ md) — Gmail layout

- Left column: **Compose** button, views with unread counts, accounts (color
  dot each), user labels.
- Top: search box. Plain words search the CRM index; Gmail operators (`from:`,
  `to:`, `subject:`, `has:attachment`, `is:unread`, `before:`, `after:`,
  `label:`) are sent to Gmail's own search (`messages.list q=`) for each
  selected account, merged by date.
- List: checkbox, star, sender(s) (bold when unread), subject — snippet,
  label chips, attachment icon, date; row hover actions: archive, trash, mark
  read/unread, snooze → sets a CRM follow-up. Bulk actions on selected rows.
- Thread: subject + labels; messages (older ones collapsed to one line, latest
  expanded); each message: sender, recipients (expandable), date, account,
  HTML body, attachments (download links); toolbar: back, archive, trash,
  mark unread, labels, star.
- **CRM panel** (right): the other participants as contact cards (status,
  organization, projects, follow-up, last contact, link to the contact page),
  "Add as contact" for unknown people, quick actions: set follow-up, add to
  project, create opportunity; **Claude**: "Summarize thread", "Draft reply"
  (writes a reply in the owner's voice into the inline composer, or into the
  approval queue).
- Composer: reply / reply all / forward inline under the thread; **Compose**
  opens a panel (bottom-right like Gmail, full screen on phones) with From
  (account picker), To/Cc/Bcc with contact autocomplete, Subject, plain-text
  body, "Write with Claude" (prompt → body), Send, Save draft, Discard.
- Keyboard shortcuts (desktop only): `c` compose, `/` search, `j`/`k`
  next/previous, `o`/Enter open, `u` back to list, `e` archive, `#` trash,
  `r` reply, `a` reply all, `f` forward, `s` star, `Shift+U` mark unread,
  `x` select.

## Phone (< md) — iPhone Mail

- `/mail`: large title (the view name), account switcher ("All Inboxes" +
  each account) as a sheet, search field under the title, rows with bold
  sender, subject, two-line snippet, time, blue unread dot.
- **Swipe actions** on rows (pointer events, no library): swipe left reveals
  Trash + Archive (a full swipe archives), swipe right toggles read/unread.
  Tapping a revealed button performs it; the row animates out.
- Thread screen: "‹ Inbox" back, messages stacked, bottom toolbar (safe-area
  aware, like iOS Mail): Archive, Trash, Reply (sheet: Reply, Reply All,
  Forward), Compose. The CRM panel becomes a "Contact" section under the
  thread, and "Draft reply with Claude" is a button in the reply sheet.
- Compose is a full-screen sheet with Cancel / Send in the header.
- The tab bar gets a **Mail** tab (Today · Mail · Approvals · Contacts · More;
  Claude moves into More and a floating button on the Today screen).

## Rendering HTML email safely

- Server-side light sanitizing: drop `<script>`, `<iframe>`, `<object>`,
  `<embed>`, `<form>`, `<base>`, `<meta http-equiv>`, `<link>`, `on*`
  attributes and `javascript:` URLs; rewrite links to open in a new tab.
- Render in `<iframe sandbox="allow-same-origin allow-popups
  allow-popups-to-escape-sandbox" srcdoc=…>` (no `allow-scripts`, so nothing
  can run) with its own CSP meta: `default-src 'none'; img-src data:;
  style-src 'unsafe-inline'; font-src data:`. Remote images therefore never
  load (no tracking pixels); inline `cid:` images are replaced with `data:`
  URIs fetched through `attachments.get` (≤ 2 MB each). A notice says remote
  images are hidden.
- The parent resizes the iframe to its content height on load; dark mode
  uses a light "paper" background inside the frame so emails stay legible.
- Plain-text parts are shown with `prose-plain`; quoted history collapsed
  behind "Show quoted text".

## Code layout

- `lib/mail/queries.ts` — thread lists, counts, thread lookup in the DB.
- `lib/mail/gmail.ts` — live thread fetch + HTML extraction, actions
  (modify/trash/untrash), send/reply/forward, labels, drafts list, attachment
  fetch; uses `gmailClientFor` and updates `label_ids`.
- `lib/mail/sanitize.ts` — the HTML sanitizer + srcdoc builder (unit tested).
- `app/(app)/mail/…` — pages; `app/api/mail/attachment/route.ts` — streams an
  attachment (session required).
- `components/mail/…` — list row (with swipe), thread view, composer, CRM panel.

## Tests

Sanitizer unit tests (scripts, handlers, javascript: links, meta refresh,
remote images left blocked by CSP, cid rewrite); DB tests for thread lists
(label views, category tabs, unread counts, account filter, pagination);
action tests with the fake Gmail (archive → INBOX removed in Gmail and DB;
send reply → threadId + headers; mark read on open).
