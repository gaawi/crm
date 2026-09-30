#!/usr/bin/env node
/**
 * Fill a LOCAL development database with fictional demo data (for trying the UI
 * without connecting Gmail). Refuses to run against a non-local database.
 *
 *   DATABASE_URL=postgres://postgres:postgres@localhost:5432/crm_dev node scripts/seed-demo.mjs
 */
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
const host = new URL(url).hostname;
if (!["localhost", "127.0.0.1", "::1"].includes(host) && !process.argv.includes("--force")) {
  console.error(`Refusing to seed demo data into ${host}. Pass --force if you really mean it.`);
  process.exit(1);
}

const sql = postgres(url, { max: 1, onnotice: () => {} });
const now = Date.now();
const ago = (days, hours = 0) => new Date(now - days * 86_400_000 - hours * 3_600_000);
const iso = (d) => d.toISOString().slice(0, 10);
const inDays = (days) => iso(new Date(now + days * 86_400_000));

const ACCOUNTS = [
  { email: "studio@example-studio.com", displayName: "Example Studio" },
  { email: "me.personal@gmail.com", displayName: "Me" },
];

const ORGS = [
  { name: "Harbor Arts Foundation", domains: ["harborarts.org"], website: "https://harborarts.org", tags: ["funder"] },
  { name: "Lumen Gallery", domains: ["lumengallery.com"], website: "https://lumengallery.com", tags: ["gallery"] },
  { name: "The Brooklyn Review", domains: ["brooklynreview.net"], website: "https://brooklynreview.net", tags: ["press"] },
  { name: "Northside Festival", domains: ["northsidefest.org"], tags: ["venue"] },
];

const CONTACTS = [
  { name: "Maya Chen", email: "maya@harborarts.org", org: "Harbor Arts Foundation", role: "Program Officer", status: "active", projects: ["Grants"], tags: ["funder"], followUp: -2, followUpNote: "Send the final budget for the spring application" },
  { name: "Daniel Okafor", email: "daniel@lumengallery.com", org: "Lumen Gallery", role: "Director", status: "active", projects: ["CreArtBox", "Booking"], tags: ["gallery", "vip"] },
  { name: "Sofia Marino", email: "sofia@brooklynreview.net", org: "The Brooklyn Review", role: "Arts Editor", status: "lead", projects: ["Press"], tags: ["press"], followUp: 0, followUpNote: "Ask about the November feature" },
  { name: "Liam Novak", email: "liam@northsidefest.org", org: "Northside Festival", role: "Booking Manager", status: "lead", projects: ["Booking"], tags: ["festival"] },
  { name: "Aisha Rahman", email: "aisha.rahman@gmail.com", role: "Photographer", status: "active", projects: ["ADAR"], tags: ["collaborator"] },
  { name: "Tomás Ruiz", email: "tomas@harborarts.org", org: "Harbor Arts Foundation", role: "Grants Coordinator", status: "active", projects: ["Grants"] },
  { name: "Emma Lindqvist", email: "emma.l@lumengallery.com", org: "Lumen Gallery", role: "Registrar", status: "active", projects: ["CreArtBox"], followUp: 4, followUpNote: "Confirm shipping dates" },
  { name: "Noah Williams", email: "noah.w@outlook.com", role: "Collector", status: "inactive", projects: ["Personal"], tags: ["collector"] },
  { name: null, email: "jordan.lee@studiomail.io", status: "new", projects: [] },
  { name: "Priya Patel", email: "priya@brooklynreview.net", org: "The Brooklyn Review", role: "Photo Editor", status: "new", projects: ["Press"] },
];

// [contactEmail, account, direction, daysAgo, subject, body]
const THREADS = [
  ["maya@harborarts.org", 0, "inbound", 21, "Spring cycle — open call", "Hi! Our spring grant cycle opens next month. Based on your ADAR proposal last year, I think you'd be a strong fit. Happy to talk through the budget section."],
  ["maya@harborarts.org", 0, "outbound", 20, "Re: Spring cycle — open call", "Thanks Maya — we'd love to apply. I'll send a draft budget by the end of the month."],
  ["maya@harborarts.org", 0, "inbound", 9, "Re: Spring cycle — open call", "Great. The deadline moved to Oct 15. Could you include a line item for documentation?"],
  ["daniel@lumengallery.com", 0, "outbound", 14, "CreArtBox winter show", "Hi Daniel, attaching the updated floor plan for the winter show. Let me know what you think about the second room."],
  ["daniel@lumengallery.com", 0, "inbound", 13, "Re: CreArtBox winter show", "Looks great. Let's lock Dec 4 for the opening. Can we do a walkthrough next Tuesday?"],
  ["daniel@lumengallery.com", 0, "outbound", 12, "Re: CreArtBox winter show", "Tuesday works — 3pm?"],
  ["sofia@brooklynreview.net", 0, "outbound", 11, "Studio visit for the November issue?", "Hi Sofia, we're opening a new CreArtBox space in Bushwick and would love to invite you for a studio visit ahead of the November issue."],
  ["liam@northsidefest.org", 0, "inbound", 2, "Booking inquiry: summer 2027 stage", "Hello! We're programming the 2027 edition and would like to book a live installation for our main stage. What are your fees and availability in June?"],
  ["aisha.rahman@gmail.com", 1, "inbound", 3, "ADAR photos", "Here's the selection from last weekend. Let me know which ones you want in high-res."],
  ["aisha.rahman@gmail.com", 1, "outbound", 1, "Re: ADAR photos", "These are beautiful — can you send 4, 7 and 12 in high-res?"],
  ["tomas@harborarts.org", 0, "inbound", 30, "Final report received", "Thank you for submitting the final report for last year's grant. Everything looks complete."],
  ["emma.l@lumengallery.com", 0, "inbound", 6, "Shipping for the winter show", "Our shipper can pick up the works on Nov 20 or 21. Which do you prefer?"],
  ["noah.w@outlook.com", 1, "outbound", 120, "Thank you", "It was great seeing you at the opening. Enjoy the piece!"],
  ["jordan.lee@studiomail.io", 0, "inbound", 4, "Collaboration idea", "Hi — I run a small print studio and I'd love to collaborate on an edition for CreArtBox. Could we chat?"],
  ["priya@brooklynreview.net", 0, "inbound", 5, "Photo request", "Sofia mentioned the new space — could we schedule a shoot for the feature?"],
];

const OPPORTUNITIES = [
  { title: "Harbor Arts spring grant", stage: "proposal", contact: "maya@harborarts.org", project: "Grants", value: "15000", followUp: 3, nextStep: "Send final budget" },
  { title: "Lumen winter show", stage: "negotiation", contact: "daniel@lumengallery.com", project: "CreArtBox", value: "8000", followUp: 1, nextStep: "Walkthrough Tuesday 3pm" },
  { title: "Northside 2027 main stage", stage: "lead", contact: "liam@northsidefest.org", project: "Booking", value: "6500", nextStep: "Send fees and June availability" },
  { title: "Brooklyn Review feature", stage: "contacted", contact: "sofia@brooklynreview.net", project: "Press", followUp: -1, nextStep: "Follow up on studio visit" },
  { title: "Collector commission", stage: "won", contact: "noah.w@outlook.com", project: "Personal", value: "4200" },
];

try {
  await sql.begin(async (tx) => {
    await tx`truncate table email_drafts, message_participants, messages, opportunities, contact_projects, contact_emails, contacts, organizations, gmail_accounts restart identity cascade`;

    const accountIds = [];
    for (const [i, a] of ACCOUNTS.entries()) {
      const [row] = await tx`
        insert into gmail_accounts (email, display_name, status, history_id, backfill_status, backfill_imported, backfill_scanned,
                                    backfill_estimate, backfill_started_at, backfill_completed_at, last_synced_at, scopes)
        values (${a.email}, ${a.displayName}, 'active', ${1000 + i}, 'done', 0, 0, 0, ${ago(2)}, ${ago(2)}, ${ago(0, 1)},
                ${["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.compose"]})
        returning id`;
      accountIds.push(row.id);
    }

    const orgIds = {};
    for (const o of ORGS) {
      const [row] = await tx`insert into organizations (name, domains, website, tags) values (${o.name}, ${o.domains}, ${o.website ?? null}, ${o.tags ?? []}) returning id`;
      orgIds[o.name] = row.id;
    }

    const projects = Object.fromEntries((await tx`select id, name from projects`).map((p) => [p.name, p.id]));
    const contactIds = {};
    for (const c of CONTACTS) {
      const [row] = await tx`
        insert into contacts (name, organization_id, role, status, tags, follow_up_at, follow_up_note, source)
        values (${c.name}, ${c.org ? orgIds[c.org] : null}, ${c.role ?? null}, ${c.status}, ${c.tags ?? []},
                ${c.followUp === undefined ? null : inDays(c.followUp)}, ${c.followUpNote ?? null}, ${c.status === "new" ? "gmail" : "manual"})
        returning id`;
      contactIds[c.email] = row.id;
      await tx`insert into contact_emails (email, contact_id, is_primary) values (${c.email}, ${row.id}, true)`;
      for (const p of c.projects) await tx`insert into contact_projects (contact_id, project_id) values (${row.id}, ${projects[p]})`;
    }

    let n = 0;
    for (const [email, accountIndex, direction, days, subject, body] of THREADS) {
      n++;
      const account = ACCOUNTS[accountIndex];
      const contact = CONTACTS.find((c) => c.email === email);
      const from = direction === "outbound" ? { email: account.email, name: account.displayName } : { email, name: contact?.name ?? null };
      const to = direction === "outbound" ? { email, name: contact?.name ?? null } : { email: account.email, name: account.displayName };
      const [m] = await tx`
        insert into messages (account_id, gmail_message_id, gmail_thread_id, rfc822_message_id, direction, from_email, from_name,
                              subject, snippet, body_text, sent_at, label_ids)
        values (${accountIds[accountIndex]}, ${"demo" + n}, ${"thread-" + email}, ${`<demo-${n}@example.com>`}, ${direction},
                ${from.email}, ${from.name}, ${subject}, ${body.slice(0, 140)}, ${body}, ${ago(days, n % 5)},
                ${direction === "outbound" ? ["SENT"] : ["INBOX", "CATEGORY_PERSONAL"]})
        returning id`;
      await tx`insert into message_participants (message_id, role, email, name) values (${m.id}, 'from', ${from.email}, ${from.name})`;
      await tx`insert into message_participants (message_id, role, email, name) values (${m.id}, 'to', ${to.email}, ${to.name})`;
    }

    for (const o of OPPORTUNITIES) {
      const contactId = contactIds[o.contact];
      const [c] = await tx`select organization_id from contacts where id = ${contactId}`;
      await tx`
        insert into opportunities (title, stage, contact_id, organization_id, project_id, value, follow_up_at, next_step, closed_at)
        values (${o.title}, ${o.stage}, ${contactId}, ${c.organizationId ?? c.organization_id ?? null}, ${projects[o.project]}, ${o.value ?? null},
                ${o.followUp === undefined ? null : inDays(o.followUp)}, ${o.nextStep ?? null}, ${["won", "lost"].includes(o.stage) ? ago(40) : null})`;
    }

    await tx`select refresh_contact_stats(array(select id from contacts))`;

    // Two emails waiting for approval.
    const liam = contactIds["liam@northsidefest.org"];
    const [liamMsg] = await tx`select m.id from messages m join message_participants mp on mp.message_id = m.id
                                where mp.email = 'liam@northsidefest.org' order by m.sent_at desc limit 1`;
    await tx`
      insert into email_drafts (account_id, contact_id, reply_to_message_id, purpose, origin, status, to_emails, subject, body_text, rationale)
      values (${accountIds[0]}, ${liam}, ${liamMsg.id}, 'reply', 'autopilot', 'proposed', ${["liam@northsidefest.org"]},
              'Re: Booking inquiry: summer 2027 stage',
              ${"Hi Liam,\n\nThank you for thinking of us for the 2027 edition — we'd love to be part of it.\n\nFor a live installation on the main stage our fee is [fee], including [what's included]. We're currently available on June 12–14 and June 19–21.\n\nWould a short call next week work to go over the technical rider?\n\nBest,\n[Your name]"},
              'Liam asked about fees and June availability two days ago and is waiting for an answer.')`;
    const maya = contactIds["maya@harborarts.org"];
    await tx`
      insert into email_drafts (account_id, contact_id, purpose, origin, status, to_emails, subject, body_text, rationale)
      values (${accountIds[0]}, ${maya}, 'follow_up', 'owner', 'proposed', ${["maya@harborarts.org"]},
              'Spring application — budget',
              ${"Hi Maya,\n\nAs promised, here is the draft budget for the spring application, including the documentation line item you suggested.\n\nLet me know if anything should be adjusted before the Oct 15 deadline.\n\nThanks again,\n[Your name]"},
              'Your follow-up with Maya was due two days ago: send the budget before the Oct 15 deadline.')`;
  });
  console.log("Demo data loaded.");
} catch (error) {
  console.error("Seeding failed:", error.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
