import type { Address, Attachment, Direction } from "@/lib/types";

/* Subset of the Gmail REST API v1 resources we use. */

export interface GmailHeader {
  name: string;
  value: string;
}

export interface GmailMessagePartBody {
  attachmentId?: string;
  size: number;
  /** base64url */
  data?: string;
}

export interface GmailMessagePart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: GmailMessagePartBody;
  parts?: GmailMessagePart[];
}

export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  historyId?: string;
  /** Epoch milliseconds as a string. */
  internalDate?: string;
  sizeEstimate?: number;
  payload?: GmailMessagePart;
}

export interface GmailMessageRef {
  id: string;
  threadId: string;
  labelIds?: string[];
}

export interface GmailListMessagesResponse {
  messages?: GmailMessageRef[];
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

export interface GmailHistoryMessageChange {
  message: GmailMessageRef;
}

export interface GmailHistoryLabelChange {
  message: GmailMessageRef;
  labelIds: string[];
}

export interface GmailHistoryRecord {
  id: string;
  messages?: GmailMessageRef[];
  messagesAdded?: GmailHistoryMessageChange[];
  messagesDeleted?: GmailHistoryMessageChange[];
  labelsAdded?: GmailHistoryLabelChange[];
  labelsRemoved?: GmailHistoryLabelChange[];
}

export interface GmailHistoryResponse {
  history?: GmailHistoryRecord[];
  nextPageToken?: string;
  /** Current mailbox historyId. */
  historyId: string;
}

export interface GmailProfile {
  emailAddress: string;
  messagesTotal: number;
  threadsTotal: number;
  historyId: string;
}

export interface GmailWatchResponse {
  historyId: string;
  /** Epoch milliseconds as a string. */
  expiration: string;
}

export interface GmailSendAs {
  sendAsEmail: string;
  displayName?: string;
  isPrimary?: boolean;
  isDefault?: boolean;
  verificationStatus?: string;
}

export interface GmailDraft {
  id: string;
  message: GmailMessageRef;
}

/* Our normalized form of a Gmail message, ready to store. */

export interface ParsedMessage {
  gmailMessageId: string;
  gmailThreadId: string;
  labelIds: string[];
  /** Message-ID header, including angle brackets, e.g. "<abc@mail.gmail.com>". */
  rfc822MessageId: string | null;
  inReplyTo: string | null;
  /** Raw References header. */
  references: string | null;
  /** SENT label ⇒ outbound. */
  direction: Direction;
  from: Address | null;
  to: Address[];
  cc: Address[];
  bcc: Address[];
  subject: string | null;
  snippet: string | null;
  /** Stripped plain-text body, ≤ MAX_BODY_CHARS; null for automated mail. */
  bodyText: string | null;
  /** From internalDate. */
  sentAt: Date;
  isAutomated: boolean;
  hasAttachments: boolean;
  attachments: Attachment[];
}
