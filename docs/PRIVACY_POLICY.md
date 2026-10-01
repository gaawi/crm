# Privacy Policy — CreArtBox CRM

_Last updated: October 1, 2026_

CreArtBox ("we") operates a private customer-relationship tool (the "CRM")
used only by CreArtBox to manage its own professional correspondence with
venues, partners, funders and press. This policy explains what data the CRM
accesses, how it is used and how it can be deleted.

## Who can use it

The CRM is a private, internal tool. It is not offered to the public. Only the
owner of the connected Gmail accounts signs in to it.

## Google user data we access

When the owner connects a Gmail account, the CRM requests the Gmail scope
`https://www.googleapis.com/auth/gmail.modify` plus the basic profile scopes
(`openid`, `email`, `profile`). With them the CRM:

- reads email messages and their metadata (sender, recipients, subject, date,
  labels, attachment names) to build a contact history;
- changes labels when the owner archives, stars, marks as read or moves a
  message to trash from the CRM;
- creates drafts and sends emails only when the owner explicitly presses
  Send or approves a draft;
- reads the account's email address and name to identify the account.

The CRM never permanently deletes email.

## How the data is used

Google user data is used only to provide the CRM's features to its owner:
showing email history per contact and organization, follow-up reminders,
search, and writing and sending the owner's emails. It is not used for
advertising, is not sold, and is not shared with third parties except the
service providers that host the CRM (see below), and only as needed to run it.

The use of information received from Google APIs adheres to the
[Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy),
including the Limited Use requirements. Google user data is not used to
develop, improve or train generalized artificial-intelligence or
machine-learning models.

## Storage and security

- Data is stored in a private database (Supabase, United States) and the
  application runs on Vercel. Both encrypt data in transit (TLS).
- Google access and refresh tokens are encrypted at rest (AES-256-GCM).
- Access to the CRM requires the owner's password. No public user accounts
  exist.

## Optional AI assistance

If the owner turns on AI drafting, the content of selected emails is sent to
Anthropic's API only to generate a draft for the owner to review. Anthropic
does not use API data to train its models. This feature is off unless enabled.

## Retention and deletion

- Disconnecting a Gmail account in the CRM's Settings revokes its Google
  access and deletes its tokens; removing the account also deletes its stored
  emails.
- Access can also be revoked at any time at
  [myaccount.google.com/permissions](https://myaccount.google.com/permissions).
- To request deletion of any data, write to info@creartbox.nyc.

## Contact

CreArtBox — info@creartbox.nyc — https://creartbox.nyc
