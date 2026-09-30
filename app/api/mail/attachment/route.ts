import { type NextRequest } from "next/server";
import { assertSession, UnauthorizedError } from "@/lib/auth";
import { GmailApiError } from "@/lib/gmail/client";
import { fetchAttachment, MailError } from "@/lib/mail/gmail";
import { isAccountId, isGmailId } from "@/lib/mail/params";
import { AccountAuthError } from "@/lib/sync/accounts";
import { ATTACHMENT_PART_ID, attachmentContentType, contentDisposition } from "@/lib/mail/attachment";

/**
 * GET /api/mail/attachment?account=&message=&part= — one attachment of a
 * message, always as a download: it is never rendered in the app's origin
 * (Content-Disposition: attachment, nosniff, CSP sandbox).
 */


function plain(status: number, message: string) {
  return new Response(message, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

export async function GET(request: NextRequest) {
  try {
    await assertSession();
  } catch (error) {
    if (error instanceof UnauthorizedError) return plain(401, "Unauthorized");
    throw error;
  }
  const params = request.nextUrl.searchParams;
  const account = params.get("account") ?? "";
  const message = params.get("message") ?? "";
  const part = params.get("part") ?? "";
  if (!isAccountId(account) || !isGmailId(message) || !ATTACHMENT_PART_ID.test(part)) return plain(400, "Invalid request");

  try {
    const file = await fetchAttachment(account.toLowerCase(), message, part);
    if (!file) return plain(404, "Attachment not found");
    return new Response(new Uint8Array(file.data), {
      status: 200,
      headers: {
        "Content-Type": attachmentContentType(file.mimeType),
        "Content-Length": String(file.data.length),
        "Content-Disposition": contentDisposition(file.filename),
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    if (error instanceof MailError || error instanceof AccountAuthError) return plain(404, error.message);
    if (error instanceof GmailApiError) return plain(error.status === 404 ? 404 : 502, "Gmail could not return this attachment.");
    console.error("Attachment download failed:", error);
    return plain(500, "Could not download the attachment.");
  }
}
