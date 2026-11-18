/** The deployed version (git commit), so an open app can tell it is out of date and reload. */
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ version: process.env.VERCEL_GIT_COMMIT_SHA ?? "dev" }, { headers: { "Cache-Control": "no-store" } });
}
