import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { summarise, type GmailMessage } from "../client.ts";
import {
  buildGmailOAuthUrl,
  createGmailOAuthState,
  GMAIL_READONLY_SCOPE,
  gmailOAuthConfigFromEnv,
  grantedScopeIsReadonly,
  verifyGmailOAuthState,
} from "../oauth.ts";
import { gmailTokenKey } from "../connection.ts";
import { withinPullHours } from "../../internal-counts/pull.ts";

const config = { clientId: "cid", clientSecret: "secret", redirectUri: "https://example.test/cb", stateSecret: "state-secret" };

describe("Gmail OAuth", () => {
  it("asks for gmail.readonly only, offline", () => {
    const url = new URL(buildGmailOAuthUrl(config, "s"));
    assert.equal(url.searchParams.get("scope"), GMAIL_READONLY_SCOPE);
    assert.equal(url.searchParams.get("access_type"), "offline");
    assert.equal(url.searchParams.get("prompt"), "consent");
  });

  it("signs and checks the state", () => {
    const { state, nonce } = createGmailOAuthState(config.stateSecret, 1_000);
    verifyGmailOAuthState({ state, expectedNonce: nonce, secret: config.stateSecret, now: 2_000 });
    assert.throws(() => verifyGmailOAuthState({ state, expectedNonce: "other", secret: config.stateSecret, now: 2_000 }));
    assert.throws(() => verifyGmailOAuthState({ state, expectedNonce: nonce, secret: "wrong", now: 2_000 }));
    assert.throws(() => verifyGmailOAuthState({ state, expectedNonce: nonce, secret: config.stateSecret, now: 1_000 + 11 * 60_000 }));
  });

  it("stores nothing wider than read-only mail", () => {
    assert.ok(grantedScopeIsReadonly(GMAIL_READONLY_SCOPE));
    assert.ok(!grantedScopeIsReadonly(`${GMAIL_READONLY_SCOPE} https://www.googleapis.com/auth/gmail.modify`));
    assert.ok(!grantedScopeIsReadonly(undefined));
  });

  it("names what's missing from the env, and wants a dedicated key of 16+ characters", () => {
    assert.deepEqual(gmailOAuthConfigFromEnv({}).missing, [
      "GMAIL_OAUTH_CLIENT_ID",
      "GMAIL_OAUTH_CLIENT_SECRET",
      "GMAIL_OAUTH_REDIRECT_URI",
      "GMAIL_OAUTH_STATE_SECRET",
    ]);
    assert.equal(gmailTokenKey({ GMAIL_TOKEN_KEY: "short" }), null);
    assert.equal(gmailTokenKey({ GOOGLE_ADS_TOKEN_KEY: "a-long-enough-key-123" }), null);
    assert.equal(gmailTokenKey({ GMAIL_TOKEN_KEY: "a-long-enough-key-123" }), "a-long-enough-key-123");
  });
});

describe("summarise", () => {
  it("takes the subject, the plain body and the PDF, not the signature image", () => {
    const b64 = (s: string) => Buffer.from(s).toString("base64url");
    const m: GmailMessage = {
      id: "m1",
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
    assert.equal(s.receivedAt, "2026-11-12T11:33:36.000Z");
    assert.equal(s.body, "Hello,\nPlease see today's internal show count attached.");
    assert.deepEqual(s.pdfs, [{ filename: "MIKE'S INTERNAL SHOWS - INTERNAL COUNTS (23).pdf", attachmentId: "pdf1" }]);
  });
});

describe("withinPullHours", () => {
  it("runs 09:00–19:59 UK time on weekdays, across BST and GMT", () => {
    assert.ok(withinPullHours(new Date("2026-11-12T09:00:00Z"))); // Thu 09:00 GMT
    assert.ok(!withinPullHours(new Date("2026-11-12T08:59:00Z")));
    assert.ok(withinPullHours(new Date("2026-11-12T19:30:00Z")));
    assert.ok(!withinPullHours(new Date("2026-11-12T20:00:00Z")));
    assert.ok(!withinPullHours(new Date("2026-11-14T12:00:00Z"))); // Saturday
    assert.ok(withinPullHours(new Date("2026-07-15T08:00:00Z"))); // 09:00 BST
    assert.ok(!withinPullHours(new Date("2026-07-15T19:00:00Z"))); // 20:00 BST
  });
});
