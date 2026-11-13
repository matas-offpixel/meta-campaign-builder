import assert from "node:assert/strict";
import { createVerify, generateKeyPairSync } from "node:crypto";
import { describe, it } from "node:test";

import { delegatedAccountFromEnv, delegatedTokenSource, GMAIL_READONLY_SCOPE, GmailAccessError, signDelegatedJwt } from "../auth.ts";
import { GmailClient, summarise, type GmailMessage } from "../client.ts";
import { clearGmailStatusCache, gmailStatus, NOT_DELEGATED, openGmailSession } from "../../internal-counts/gmail-session.ts";
import { withinPullHours } from "../../internal-counts/pull.ts";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const SA = JSON.stringify({ type: "service_account", client_email: "offpixel-sheets-reader@off-pixel-dashboard.iam.gserviceaccount.com", private_key: PEM });
const ENV = { GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON: SA, GMAIL_INGEST_MAILBOX: "matas@offpixel.co.uk" } as unknown as NodeJS.ProcessEnv;

/** A fake Google token endpoint: answers with a token, or with an OAuth error code. */
function tokenEndpoint(answer: { access_token?: string; error?: string }, status = 200) {
  const seen: string[] = [];
  const fetcher = async (_url: string, init: RequestInit) => {
    seen.push(String((init.body as URLSearchParams).get("assertion")));
    return { ok: status === 200, status, json: async () => answer };
  };
  return { fetcher, seen };
}

const decode = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;

describe("Gmail via the Drive service account (domain-wide delegation)", () => {
  it("signs a JWT for the mailbox with gmail.readonly only", () => {
    const account = delegatedAccountFromEnv(ENV);
    const jwt = signDelegatedJwt(account, 1_000);
    const [header, claims, signature] = jwt.split(".");
    assert.deepEqual(decode(header), { alg: "RS256", typ: "JWT" });
    assert.deepEqual(decode(claims), {
      iss: "offpixel-sheets-reader@off-pixel-dashboard.iam.gserviceaccount.com",
      sub: "matas@offpixel.co.uk",
      scope: GMAIL_READONLY_SCOPE,
      aud: "https://oauth2.googleapis.com/token",
      iat: 1_000,
      exp: 4_600,
    });
    const v = createVerify("RSA-SHA256");
    v.update(`${header}.${claims}`);
    assert.ok(v.verify(publicKey, Buffer.from(signature, "base64url")));
  });

  it("names what's missing from the env, and never the key", () => {
    assert.throws(
      () => delegatedAccountFromEnv({} as NodeJS.ProcessEnv),
      (e: unknown) => e instanceof GmailAccessError && e.problem === "not_configured" && /GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON, GMAIL_INGEST_MAILBOX/.test(e.message),
    );
    assert.throws(
      () => delegatedAccountFromEnv({ ...ENV, GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON: "not json" } as unknown as NodeJS.ProcessEnv),
      (e: unknown) => e instanceof GmailAccessError && !e.message.includes("PRIVATE KEY"),
    );
  });

  it("maps unauthorized_client (delegation not granted) to not_delegated", async () => {
    const { fetcher } = tokenEndpoint({ error: "unauthorized_client" }, 401);
    const token = delegatedTokenSource(delegatedAccountFromEnv(ENV), fetcher);
    await assert.rejects(token(), (e: unknown) => e instanceof GmailAccessError && e.problem === "not_delegated" && !/eyJ/.test(e.message));
  });

  it("caches the access token", async () => {
    const { fetcher, seen } = tokenEndpoint({ access_token: "ya29.fake" });
    const token = delegatedTokenSource(delegatedAccountFromEnv(ENV), fetcher);
    assert.equal(await token(), "ya29.fake");
    assert.equal(await token(), "ya29.fake");
    assert.equal(seen.length, 1);
  });

  it("a 403 for the Gmail API not being enabled is setup, not an outage", async () => {
    const client = new GmailClient(async () => "t", async () => ({
      ok: false,
      status: 403,
      json: async () => ({ error: { status: "PERMISSION_DENIED", details: [{ reason: "SERVICE_DISABLED" }] } }),
    }));
    await assert.rejects(client.profileEmail(), (e: unknown) => e instanceof GmailAccessError && e.problem === "not_delegated");
  });
});

describe("openGmailSession and the status line", () => {
  it("the cron's skippedReason is gmail_not_delegated until the delegation is granted", async () => {
    const { fetcher } = tokenEndpoint({ error: "unauthorized_client" }, 401);
    const s = await openGmailSession(ENV, { token: fetcher });
    assert.deepEqual(s, { ok: false, reason: NOT_DELEGATED, mailbox: "matas@offpixel.co.uk" });
  });

  it("a missing env is a not_configured reason, not a throw", async () => {
    const s = await openGmailSession({} as NodeJS.ProcessEnv);
    assert.equal(s.ok, false);
    assert.match((s as { reason: string }).reason, /^not_configured: /);
  });

  it("reads 'reading' once a read works, 'not_set_up' before", async () => {
    clearGmailStatusCache();
    const denied = tokenEndpoint({ error: "unauthorized_client" }, 401);
    assert.deepEqual(await gmailStatus(ENV, { token: denied.fetcher }, 1), { state: "not_set_up", mailbox: "matas@offpixel.co.uk" });
    const ok = tokenEndpoint({ access_token: "ya29.fake" });
    const api = async () => ({ ok: true, status: 200, json: async () => ({ emailAddress: "matas@offpixel.co.uk" }) });
    assert.deepEqual(await gmailStatus(ENV, { token: ok.fetcher, api }, 1 + 6 * 60_000), {
      state: "reading",
      mailbox: "matas@offpixel.co.uk",
      readAt: new Date(1 + 6 * 60_000).toISOString(),
    });
    clearGmailStatusCache();
  });
});

describe("summarise", () => {
  it("takes the subject, the plain body and the PDF, not the signature image", () => {
    const b64 = (s: string) => Buffer.from(s).toString("base64url");
    const m: GmailMessage = {
      id: "m1",
      threadId: "t1",
      internalDate: String(Date.UTC(2026, 10, 12, 11, 33, 36)),
      payload: {
        headers: [
          { name: "Subject", value: "Internal Show Count 12.11.26" },
          { name: "From", value: "Rachel Chadwick <Rachel@electric-group.co.uk>" },
        ],
        parts: [
          {
            mimeType: "multipart/alternative",
            parts: [
              { mimeType: "text/plain", body: { data: b64("Hello,\r\nPlease see today's internal show count attached.") } },
              { mimeType: "text/html", body: { data: b64("<p>Hello</p>") } },
            ],
          },
          { mimeType: "image/png", filename: "image.png", body: { attachmentId: "img" } },
          { mimeType: "application/pdf", filename: "MIKE'S INTERNAL SHOWS - INTERNAL COUNTS (23).pdf", body: { attachmentId: "pdf1" } },
        ],
      },
    };
    const s = summarise(m);
    assert.equal(s.subject, "Internal Show Count 12.11.26");
    assert.equal(s.threadId, "t1");
    assert.equal(s.receivedAt, "2026-11-12T11:33:36.000Z");
    assert.equal(s.body, "Hello,\nPlease see today's internal show count attached.");
    assert.deepEqual(s.pdfs, [{ filename: "MIKE'S INTERNAL SHOWS - INTERNAL COUNTS (23).pdf", attachmentId: "pdf1" }]);
  });
});

describe("withinPullHours", () => {
  it("runs 09:00–19:59 UK time on weekdays, across BST and GMT", () => {
    assert.ok(withinPullHours(new Date("2026-11-12T09:00:00Z")));
    assert.ok(!withinPullHours(new Date("2026-11-12T08:59:00Z")));
    assert.ok(withinPullHours(new Date("2026-11-12T19:30:00Z")));
    assert.ok(!withinPullHours(new Date("2026-11-12T20:00:00Z")));
    assert.ok(!withinPullHours(new Date("2026-11-14T12:00:00Z")));
    assert.ok(withinPullHours(new Date("2026-07-15T08:00:00Z")));
    assert.ok(!withinPullHours(new Date("2026-07-15T19:00:00Z")));
  });
});
