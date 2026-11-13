/**
 * lib/gmail/client.ts
 *
 * The Gmail API reads the Internal Counts pull needs: the profile, a
 * message search, one message, one thread, one attachment. Read-only
 * (gmail.readonly); there is no send, modify or label call here. The token
 * comes from lib/gmail/auth.ts (the service account acting as the mailbox).
 */

import { GmailAccessError } from "./auth.ts";

export type GmailFetch = (input: string, init: RequestInit) => Promise<Pick<Response, "ok" | "status" | "json">>;

const API = "https://gmail.googleapis.com/gmail/v1/users/me";

/** A 403 that means the Gmail API isn't switched on for the project (setup, not an outage). */
function apiNotEnabled(body: { error?: { status?: string; errors?: Array<{ reason?: string }>; details?: Array<{ reason?: string }> } }): boolean {
  const reasons = [...(body.error?.errors ?? []), ...(body.error?.details ?? [])].map((e) => e.reason ?? "");
  return reasons.some((r) => r === "accessNotConfigured" || r === "SERVICE_DISABLED");
}

export class GmailClient {
  private readonly token: () => Promise<string>;
  private readonly fetcher: GmailFetch;

  constructor(token: () => Promise<string>, fetcher: GmailFetch = fetch) {
    this.token = token;
    this.fetcher = fetcher;
  }

  private async get<T>(path: string): Promise<T> {
    const res = await this.fetcher(`${API}${path}`, {
      headers: { Authorization: `Bearer ${await this.token()}` },
      cache: "no-store",
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as Parameters<typeof apiNotEnabled>[0];
      const where = `Gmail ${path.split("?")[0].replace(/\/[A-Za-z0-9_-]{10,}/g, "/…")}`;
      const message = `${where} returned ${res.status}${body.error?.status ? ` (${body.error.status})` : ""}.`;
      throw new GmailAccessError(res.status === 403 && apiNotEnabled(body) ? "not_delegated" : "failed", res.status, message);
    }
    return (await res.json()) as T;
  }

  async profileEmail(): Promise<string> {
    return (await this.get<{ emailAddress: string }>("/profile")).emailAddress;
  }

  /** Every message id matching `q`, newest first, following nextPageToken. */
  async listMessageIds(q: string, max = 2000): Promise<string[]> {
    const ids: string[] = [];
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({ q, maxResults: "500" });
      if (pageToken) params.set("pageToken", pageToken);
      const page = await this.get<{ messages?: Array<{ id: string }>; nextPageToken?: string }>(`/messages?${params}`);
      ids.push(...(page.messages ?? []).map((m) => m.id));
      pageToken = page.nextPageToken;
    } while (pageToken && ids.length < max);
    return ids.slice(0, max);
  }

  async message(id: string): Promise<GmailMessage> {
    return this.get<GmailMessage>(`/messages/${encodeURIComponent(id)}?format=full`);
  }

  /** Every message in a thread (format=full). */
  async thread(threadId: string): Promise<GmailMessage[]> {
    const t = await this.get<{ messages?: GmailMessage[] }>(`/threads/${encodeURIComponent(threadId)}?format=full`);
    return t.messages ?? [];
  }

  async attachment(messageId: string, attachmentId: string): Promise<Uint8Array> {
    const a = await this.get<{ data: string }>(
      `/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
    );
    return new Uint8Array(Buffer.from(a.data, "base64url"));
  }
}

export interface GmailPart {
  mimeType?: string;
  filename?: string;
  headers?: Array<{ name: string; value: string }>;
  body?: { data?: string; attachmentId?: string; size?: number };
  parts?: GmailPart[];
}

export interface GmailMessage {
  id: string;
  threadId?: string;
  internalDate: string;
  payload: GmailPart;
}

export interface MessageSummary {
  id: string;
  threadId: string | null;
  subject: string;
  from: string;
  receivedAt: string;
  /** The Date header (ISO), or receivedAt when it's missing or unreadable. */
  sentAt: string;
  body: string;
  pdfs: Array<{ filename: string; attachmentId: string }>;
}

function walk(part: GmailPart, visit: (p: GmailPart) => void): void {
  visit(part);
  for (const p of part.parts ?? []) walk(p, visit);
}

const decode = (data: string) => Buffer.from(data, "base64url").toString("utf8");

function htmlToText(html: string): string {
  return html
    .replace(/<(br|\/p|\/div|\/tr)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

export function summarise(m: GmailMessage): MessageSummary {
  const header = (name: string) =>
    m.payload.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
  let plain = "";
  let html = "";
  const pdfs: MessageSummary["pdfs"] = [];
  walk(m.payload, (p) => {
    const isPdf = /\.pdf$/i.test(p.filename ?? "") || p.mimeType === "application/pdf";
    if (p.filename && isPdf && p.body?.attachmentId) {
      pdfs.push({ filename: p.filename, attachmentId: p.body.attachmentId });
    } else if (!p.filename && p.body?.data) {
      if (p.mimeType === "text/plain" && !plain) plain = decode(p.body.data);
      if (p.mimeType === "text/html" && !html) html = decode(p.body.data);
    }
  });
  return {
    id: m.id,
    threadId: m.threadId ?? null,
    subject: header("Subject"),
    from: header("From"),
    receivedAt: new Date(Number(m.internalDate)).toISOString(),
    sentAt: Number.isFinite(Date.parse(header("Date")))
      ? new Date(Date.parse(header("Date"))).toISOString()
      : new Date(Number(m.internalDate)).toISOString(),
    body: (plain || htmlToText(html)).replace(/\r\n/g, "\n").trim(),
    pdfs,
  };
}
