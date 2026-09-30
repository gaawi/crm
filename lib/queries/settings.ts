import "server-only";
import { sql } from "@/lib/db";

/** Settings edited in the app (stored in app_settings as JSON). */
export interface AppSettings {
  profile: {
    /** How emails are signed, e.g. "Ana". */
    name: string;
    /** Optional signature block appended by Claude ("Ana García\nCreArtBox · +1 …"). */
    signature: string;
    /** Extra writing guidance for Claude ("warm but brief; Spanish with Spanish speakers"). */
    style: string;
  };
  autopilot: {
    /** Prepare follow-up drafts automatically (they still need approval). */
    enabled: boolean;
    /** Most drafts prepared per run. */
    maxPerRun: number;
    needsReply: boolean;
    followUpsDue: boolean;
    awaitingReply: boolean;
    /** Only nudge after this many days without an answer. */
    awaitingDays: number;
    lastRunAt: string | null;
  };
}

export const DEFAULT_SETTINGS: AppSettings = {
  profile: { name: "", signature: "", style: "" },
  autopilot: {
    enabled: false,
    maxPerRun: 8,
    needsReply: true,
    followUpsDue: true,
    awaitingReply: true,
    awaitingDays: 7,
    lastRunAt: null,
  },
};

export async function getSettings<K extends keyof AppSettings>(key: K): Promise<AppSettings[K]> {
  const [row] = await sql<{ value: Partial<AppSettings[K]> }[]>`select value from app_settings where key = ${key}`;
  return { ...DEFAULT_SETTINGS[key], ...(row?.value ?? {}) } as AppSettings[K];
}

export async function saveSettings<K extends keyof AppSettings>(key: K, patch: Partial<AppSettings[K]>): Promise<AppSettings[K]> {
  const next = { ...(await getSettings(key)), ...patch };
  await sql`
    insert into app_settings (key, value, updated_at) values (${key}, ${sql.json(next as never)}, now())
    on conflict (key) do update set value = excluded.value, updated_at = now()
  `;
  return next;
}
