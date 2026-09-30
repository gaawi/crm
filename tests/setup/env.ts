/** Deterministic environment for every test file. */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/crm_test";

process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.APP_URL = "http://localhost:3000";
process.env.APP_PASSWORD = "test-password";
process.env.SESSION_SECRET = "test-session-secret-0123456789abcdef";
process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.GOOGLE_CLIENT_ID = "test-client-id.apps.googleusercontent.com";
process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
process.env.CRON_SECRET = "test-cron-secret";
process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
process.env.APP_TIMEZONE = "America/New_York";
delete process.env.GMAIL_PUBSUB_TOPIC;
delete process.env.PUBSUB_VERIFICATION_TOKEN;
delete process.env.SYNC_SKIP_CATEGORIES;
delete process.env.GMAIL_BACKFILL_QUERY;
delete process.env.MCP_API_KEY;
