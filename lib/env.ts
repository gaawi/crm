import "server-only";

/**
 * Typed, lazy access to configuration. Nothing is read at import time, so
 * `next build` works without secrets; a missing variable throws a clear error
 * the first time a feature that needs it runs.
 */

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

function read(name: string): string | undefined {
  const value = process.env[name];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function required(name: string): string {
  const value = read(name);
  if (!value) throw new ConfigError(`Missing environment variable ${name}`);
  return value;
}

export const env = {
  get databaseUrl(): string {
    return required("DATABASE_URL");
  },

  /** Public base URL of the app, without trailing slash. */
  get appUrl(): string {
    const explicit = read("APP_URL");
    if (explicit) return explicit.replace(/\/+$/, "");
    const vercel = read("VERCEL_PROJECT_PRODUCTION_URL");
    if (vercel) return `https://${vercel}`;
    return "http://localhost:3000";
  },

  get appPassword(): string {
    return required("APP_PASSWORD");
  },

  get sessionSecret(): string {
    const value = required("SESSION_SECRET");
    if (value.length < 32) throw new ConfigError("SESSION_SECRET must be at least 32 characters");
    return value;
  },

  /** 32-byte key for AES-256-GCM, given as base64 (or 64 hex chars). */
  get tokenEncryptionKey(): Buffer {
    const value = required("TOKEN_ENCRYPTION_KEY");
    const key = /^[0-9a-f]{64}$/i.test(value) ? Buffer.from(value, "hex") : Buffer.from(value, "base64");
    if (key.length !== 32) {
      throw new ConfigError("TOKEN_ENCRYPTION_KEY must be 32 bytes (base64 or 64 hex characters)");
    }
    return key;
  },

  get googleClientId(): string {
    return required("GOOGLE_CLIENT_ID");
  },

  get googleClientSecret(): string {
    return required("GOOGLE_CLIENT_SECRET");
  },

  /** Shared secret for Vercel Cron and internal self-requests. */
  get cronSecret(): string {
    return required("CRON_SECRET");
  },

  /** `projects/<project>/topics/<topic>`; push sync is disabled when unset. */
  get pubsubTopic(): string | undefined {
    return read("GMAIL_PUBSUB_TOPIC");
  },

  get pubsubVerificationToken(): string | undefined {
    return read("PUBSUB_VERIFICATION_TOKEN");
  },

  get anthropicApiKey(): string {
    return required("ANTHROPIC_API_KEY");
  },

  get anthropicModel(): string {
    return read("ANTHROPIC_MODEL") ?? "claude-opus-5-5";
  },

  /** Enables /api/mcp when set. */
  get mcpApiKey(): string | undefined {
    return read("MCP_API_KEY");
  },

  get timezone(): string {
    return read("APP_TIMEZONE") ?? "America/New_York";
  },

  /** Gmail categories that are not imported, e.g. ["promotions"]. Default: import everything. */
  get skipCategories(): string[] {
    const value = read("SYNC_SKIP_CATEGORIES");
    if (value === undefined || value.toLowerCase() === "none") return [];
    return value
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
  },

  /** Extra Gmail search terms for the first import, e.g. "after:2021/01/01". */
  get backfillQuery(): string | undefined {
    return read("GMAIL_BACKFILL_QUERY");
  },

  /** Extra addresses that are "me" but not connected (comma-separated), never contacts. */
  get ownEmails(): string[] {
    return (read("OWN_EMAILS") ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.includes("@"));
  },

  get isProduction(): boolean {
    return process.env.NODE_ENV === "production";
  },
};
