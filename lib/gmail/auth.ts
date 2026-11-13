/**
 * lib/gmail/auth.ts
 *
 * Gmail access for the Internal Counts pull: the Drive service account
 * (GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON) acting as one mailbox through
 * Workspace domain-wide delegation. The JWT carries subject =
 * GMAIL_INGEST_MAILBOX and scope gmail.readonly only, RS256-signed with
 * Node's crypto (no Google client library, as lib/drive/client.ts does).
 *
 * Until Matas grants the delegation in the Workspace admin console, Google
 * answers the token request with `unauthorized_client`; that maps to
 * `not_delegated`, which the cron reports as skippedReason
 * "gmail_not_delegated". Never logs the key or a token.
 */

import { createSign } from "node:crypto";

import { parseServiceAccountJson } from "../clients/asset-queue/drive-auth.ts";

export const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

export type GmailAccessProblem = "not_configured" | "not_delegated" | "failed";

/** A failure to get or use Gmail access. The message never carries a key or a token. */
export class GmailAccessError extends Error {
  readonly problem: GmailAccessProblem;
  readonly status: number;
  constructor(problem: GmailAccessProblem, status: number, message: string) {
    super(message);
    this.problem = problem;
    this.status = status;
  }
}

export interface DelegatedAccount {
  clientEmail: string;
  privateKey: string;
  tokenUri: string;
  mailbox: string;
}

export type TokenFetch = (input: string, init: RequestInit) => Promise<Pick<Response, "ok" | "status" | "json">>;

/** The service account and mailbox from the env, or a not_configured error naming what's missing. */
export function delegatedAccountFromEnv(env: NodeJS.ProcessEnv = process.env): DelegatedAccount {
  const mailbox = env.GMAIL_INGEST_MAILBOX?.trim();
  const raw = env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON;
  const missing = [!raw?.trim() && "GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON", !mailbox && "GMAIL_INGEST_MAILBOX"].filter(Boolean);
  if (missing.length) throw new GmailAccessError("not_configured", 0, `${missing.join(", ")} not set`);
  let sa: { client_email?: string; private_key?: string; token_uri?: string };
  try {
    sa = parseServiceAccountJson(raw!);
  } catch {
    throw new GmailAccessError("not_configured", 0, "GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON isn't a service-account key");
  }
  if (!sa.client_email || !sa.private_key) {
    throw new GmailAccessError("not_configured", 0, "GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON has no client_email or private_key");
  }
  return { clientEmail: sa.client_email, privateKey: sa.private_key, tokenUri: sa.token_uri || TOKEN_ENDPOINT, mailbox: mailbox! };
}

const b64url = (input: Buffer | string) => Buffer.from(input).toString("base64url");

/** The signed JWT assertion: issuer the service account, subject the mailbox, gmail.readonly only. */
export function signDelegatedJwt(account: DelegatedAccount, nowSeconds = Math.floor(Date.now() / 1000)): string {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: account.clientEmail,
      sub: account.mailbox,
      scope: GMAIL_READONLY_SCOPE,
      aud: account.tokenUri,
      iat: nowSeconds,
      exp: nowSeconds + 3600,
    }),
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  return `${header}.${claims}.${b64url(signer.sign(account.privateKey))}`;
}

/** Google's token errors that mean the delegation (or the Gmail API) isn't set up yet. */
const NOT_DELEGATED = new Set(["unauthorized_client", "access_denied", "invalid_scope"]);

/** A cached access-token getter for the mailbox. */
export function delegatedTokenSource(account: DelegatedAccount, fetcher: TokenFetch = fetch): () => Promise<string> {
  let cached: { token: string; until: number } | null = null;
  return async () => {
    if (cached && Date.now() < cached.until) return cached.token;
    const res = await fetcher(account.tokenUri, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: signDelegatedJwt(account),
      }),
      cache: "no-store",
    });
    const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
    if (!res.ok || !body.access_token) {
      const code = body.error ?? "";
      // Google's error code only, never the body or the assertion.
      throw new GmailAccessError(
        NOT_DELEGATED.has(code) ? "not_delegated" : "failed",
        res.status,
        `Google refused the Gmail token (HTTP ${res.status}${code ? `, ${code}` : ""}).`,
      );
    }
    cached = { token: body.access_token, until: Date.now() + ((body.expires_in ?? 3600) - 300) * 1000 };
    return cached.token;
  };
}
