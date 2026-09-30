import type { Address } from "@/lib/types";

/** Serializable thread for the client view (live from Gmail, or the stored copy). */

export interface ThreadAttachmentView {
  /** MIME part id for the download route; null for the stored copy (no download). */
  partId: string | null;
  filename: string;
  mimeType: string;
  size: number;
}

export interface ThreadMessageView {
  /** Gmail message id. */
  id: string;
  from: Address | null;
  to: Address[];
  cc: Address[];
  replyTo: Address[];
  date: Date;
  outbound: boolean;
  unread: boolean;
  starred: boolean;
  subject: string | null;
  snippet: string;
  /** buildSrcDoc() output for the sandboxed iframe, or null for plain text. */
  srcDoc: string | null;
  remoteImages: number;
  text: string | null;
  textWithoutQuotes: string | null;
  attachments: ThreadAttachmentView[];
}

export interface ThreadViewData {
  key: string;
  accountId: string;
  accountEmail: string;
  threadId: string;
  subject: string | null;
  labelIds: string[];
  gmailUrl: string;
  source: "live" | "stored";
  messages: ThreadMessageView[];
}

export interface ThreadLabelOption {
  id: string;
  name: string;
  color: string | null;
}
