import { afterAll, beforeEach } from "vitest";
import { closeDb, sql } from "@/lib/db";

/**
 * Use in DB-backed test files:
 *   import { useTestDatabase } from "../setup/db";
 *   useTestDatabase();
 * Truncates every table before each test (projects are re-seeded) and closes
 * the pool after the file.
 */
export function useTestDatabase() {
  beforeEach(async () => {
    await resetDatabase();
  });
  afterAll(async () => {
    await closeDb();
  });
}

export async function resetDatabase() {
  await sql.unsafe(`
    truncate table message_participants, messages, opportunities, contact_projects,
      contact_emails, contacts, organizations, projects, gmail_accounts restart identity cascade;
    insert into projects (name, color, sort_order) values
      ('CreArtBox','violet',1),('ADAR','blue',2),('Personal','green',3),
      ('Booking','amber',4),('Press','rose',5),('Grants','teal',6);
  `);
}

/** Insert a connected account row directly (no OAuth). */
export async function insertAccount(email: string, extra: Record<string, unknown> = {}): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    insert into gmail_accounts ${sql({ email, ...extra } as never)}
    returning id
  `;
  return row.id;
}
