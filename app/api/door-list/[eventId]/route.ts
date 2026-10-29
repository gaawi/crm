import { assertSession, UnauthorizedError } from "@/lib/auth";
import { doorListHtml } from "@/lib/guests/door-list";
import { listGuests } from "@/lib/queries/guests";
import { getListingEvent } from "@/lib/queries/listings";
import { renderPdf } from "@/lib/sites/screenshot";

/** GET /api/door-list/<concert id>: the concert's door list as a PDF to download (?view=1 opens it instead). */
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request, { params }: RouteContext<"/api/door-list/[eventId]">) {
  try {
    await assertSession();
  } catch (error) {
    if (error instanceof UnauthorizedError) return new Response("Unauthorized", { status: 401 });
    throw error;
  }
  const { eventId } = await params;
  if (!UUID.test(eventId)) return new Response("Not found", { status: 404 });
  const [event, everyone] = await Promise.all([getListingEvent(eventId), listGuests(eventId)]);
  if (!event) return new Response("Not found", { status: 404 });
  const pdf = await renderPdf(doorListHtml(event, everyone));
  const day = new Intl.DateTimeFormat("en-US", { timeZone: event.timeZone, month: "short", day: "numeric" }).format(event.startsAt);
  const file = `Door list - ${event.title} - ${day}.pdf`.replace(/[^\w .,()-]/g, "");
  const inline = new URL(request.url).searchParams.get("view") === "1";
  return new Response(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${file}"`,
      "Cache-Control": "no-store",
    },
  });
}
