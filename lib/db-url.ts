/**
 * Supabase's transaction pooler (port 6543) cannot carry postgres.js's
 * pipelined queries: when a page runs several queries at once, the pooler
 * routes parts of them to different server connections and they hang
 * forever (waiting in "ClientRead"). The session pooler on the same host
 * (port 5432) keeps one server connection per client connection, so
 * pipelining works. A transaction-pooler URL is therefore switched to the
 * session pooler.
 */
export function sessionPoolerUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.endsWith(".pooler.supabase.com") && parsed.port === "6543") {
      parsed.port = "5432";
      return parsed.toString();
    }
  } catch {
    // Not a URL postgres.js would accept either; leave it for its own error.
  }
  return url;
}
