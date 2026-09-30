/** Download headers for email attachments (pure; used by app/api/mail/attachment). */

/** Gmail MIME part ids: "0", "1", "1.2.3"… */
export const ATTACHMENT_PART_ID = /^[0-9]+(?:\.[0-9]+){0,20}$/;

/** Types a browser could render as a document (or script) are sent as opaque bytes. */
const ACTIVE_TYPES = /(html|xml|svg|javascript|ecmascript|x-shockwave)/i;

/** RFC 6266 / 5987: ASCII fallback plus the UTF-8 name. */
export function contentDisposition(filename: string): string {
  const cleaned = filename.replace(/[\u0000-\u001f\u007f/\\]+/g, "_").trim() || "attachment";
  const ascii = cleaned.replace(/[^\x20-\x7e]/g, "_").replace(/["%;]/g, "_");
  const encoded = encodeURIComponent(cleaned).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/** The attachment's type when it is a plain, inert media type; otherwise application/octet-stream. */
export function attachmentContentType(mimeType: string): string {
  const type = mimeType.trim().toLowerCase();
  if (!/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(type) || ACTIVE_TYPES.test(type) || type.startsWith("text/")) return "application/octet-stream";
  return type;
}
