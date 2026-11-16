import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { sql } from "@/lib/db";

/**
 * Who is using the app on this browser: Guillermo or Josefina. Same login for
 * both; the choice ("I am…" on Today) is remembered in a cookie and only
 * changes what Today and Approvals show: each person sees the emails and mass
 * mailings of their own Gmail accounts, and the follow-ups of the booking
 * sheets that send from them. Everything else (contacts, organizations,
 * campaigns, mail) stays shared.
 *
 * Josefina's accounts come from app_settings "personas" ({"josefina": ["a@b"]});
 * every other account is Guillermo's.
 */

export const PERSONAS = [
  { key: "guillermo", label: "Guillermo" },
  { key: "josefina", label: "Josefina" },
] as const;
export type Persona = (typeof PERSONAS)[number]["key"];

export const PERSONA_COOKIE = "crm_persona";
const DEFAULT_JOSEFINA = ["josefinaupd@gmail.com"];

export const currentPersona = cache(async (): Promise<Persona> => {
  const value = (await cookies()).get(PERSONA_COOKIE)?.value;
  return value === "josefina" ? "josefina" : "guillermo";
});

export interface PersonaScope {
  persona: Persona;
  /** Gmail accounts of this person. */
  accountIds: Set<string>;
  accountEmails: Set<string>;
  /** Booking sheets (projects) that send from this person's accounts; sheets with no send account count as Guillermo's. */
  projectIds: Set<string>;
  /** Items that belong to no sheet (plain contacts, other emails) show for Guillermo only. */
  ownsUnassigned: boolean;
}

export const personaScope = cache(async (): Promise<PersonaScope> => {
  const persona = await currentPersona();
  const [setting] = await sql<{ value: { josefina?: string[] } | null }[]>`select value from app_settings where key = 'personas'`;
  const josefina = (setting?.value?.josefina?.length ? setting.value.josefina : DEFAULT_JOSEFINA).map((e) => e.toLowerCase());
  const accounts = await sql<{ id: string; email: string }[]>`select id, lower(email) as email from gmail_accounts`;
  const mine = accounts.filter((a) => (persona === "josefina" ? josefina.includes(a.email) : !josefina.includes(a.email)));
  const ids = mine.map((a) => a.id);
  const projects = await sql<{ id: string }[]>`
    select id from projects
     where ${persona === "josefina" ? sql`send_account_id = any(${ids}::uuid[])` : sql`(send_account_id is null or send_account_id = any(${ids}::uuid[]))`}`;
  return {
    persona,
    accountIds: new Set(ids),
    accountEmails: new Set(mine.map((a) => a.email)),
    projectIds: new Set(projects.map((p) => p.id)),
    ownsUnassigned: persona === "guillermo",
  };
});
