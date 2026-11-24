import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CLAUDE_CALLBACK } from "../config.ts";
import { pkceChallengeFor } from "../crypto.ts";
import { checkAuthorizeRequest, decideConsentRequest, exchangeToken, registerClient } from "../oauth/flow.ts";
import { CLIENT_NAME_MAX, CONSENT_WORDS, consentContent, displayClientName, returnKindOf } from "../oauth/consent-words.ts";
import { OPERATOR, STRANGER, VERIFIER, connect, makeDeps, urls } from "./helpers.ts";

const EMAIL = "op@example.com";
const LOOP = "http://localhost:53682/callback";

test("consent words are pinned (design's ruling, 24 Nov)", () => {
  assert.deepEqual(consentContent({ redirectUri: CLAUDE_CALLBACK, clientName: "Claude", email: EMAIL, returnHost: "claude.ai" }), {
    kind: "claude",
    title: "Connect Claude to Off/Pixel",
    lines: [
      "Claude is asking to read Off/Pixel as op@example.com.",
      "It can read every client's events, spend, signup and ticket counts, drafts and learnings. It can't change anything.",
      "It stays connected until you disconnect it in Claude, or after 30 days without use.",
      "After you allow it, you go back to claude.ai.",
    ],
  });
  assert.deepEqual(consentContent({ redirectUri: LOOP, clientName: "Inspector", email: EMAIL, returnHost: "localhost:53682" }), {
    kind: "loopback",
    title: "Connect an app on this computer to Off/Pixel",
    lines: [
      "An app on this computer, calling itself “Inspector”, is asking to read Off/Pixel as op@example.com.",
      "It can read every client's events, spend, signup and ticket counts, drafts and learnings. It can't change anything.",
      "It stays connected until you disconnect it in Claude, or after 30 days without use.",
      "After you allow it, you go back to localhost:53682.",
    ],
  });
  assert.equal(
    consentContent({ redirectUri: LOOP, clientName: null, email: EMAIL, returnHost: "localhost:53682" }).lines[0],
    "An app on this computer is asking to read Off/Pixel as op@example.com.",
  );
  assert.equal(consentContent({ redirectUri: LOOP, clientName: "   ", email: EMAIL, returnHost: "x" }).lines[0], "An app on this computer is asking to read Off/Pixel as op@example.com.");
  assert.equal(CONSENT_WORDS.allow, "Allow");
  assert.equal(CONSENT_WORDS.cancel, "Cancel");
  assert.equal(CONSENT_WORDS.invalid, "This connection link isn't valid. Start again from Claude.");
  assert.equal(CONSENT_WORDS.signedOut, "Sign in to Off/Pixel first, then connect again from Claude.");
  assert.equal(CONSENT_WORDS.notOperator, "This account can't connect Claude to Off/Pixel.");
});

test("the wording follows the redirect URI, never the registered name", () => {
  // A loopback client calling itself "Claude" is still an app on this computer.
  const fake = consentContent({ redirectUri: LOOP, clientName: "Claude", email: EMAIL, returnHost: "localhost:53682" });
  assert.equal(fake.title, CONSENT_WORDS.titleLoopback);
  assert.match(fake.lines[0], /^An app on this computer, calling itself “Claude”/);
  // Claude's callback says Claude whatever the client registered as.
  const named = consentContent({ redirectUri: CLAUDE_CALLBACK, clientName: "Something Else", email: EMAIL, returnHost: "claude.ai" });
  assert.equal(named.title, CONSENT_WORDS.titleClaude);
  assert.doesNotMatch(named.lines[0], /Something Else/);
  assert.equal(returnKindOf(`${CLAUDE_CALLBACK}/`), "loopback", "only the exact callback reads as Claude");
});

test("the wording is chosen on the redirect_uri the request carries, matched to the registered client", async () => {
  const deps = makeDeps();
  const reg = await registerClient({ client_name: "Claude", redirect_uris: [CLAUDE_CALLBACK, LOOP] }, deps);
  const clientId = (reg.body as { client_id: string }).client_id;
  const base = { response_type: "code", client_id: clientId, code_challenge: pkceChallengeFor(VERIFIER), code_challenge_method: "S256" };
  for (const [redirect, kind] of [
    [CLAUDE_CALLBACK, "claude"],
    ["http://localhost:61000/callback", "loopback"],
  ] as const) {
    const check = await checkAuthorizeRequest({ ...base, redirect_uri: redirect }, urls, deps);
    assert.ok(check.ok);
    assert.equal(check.request.redirectUri, redirect);
    assert.equal(consentContent({ redirectUri: check.request.redirectUri, clientName: check.request.client.client_name, email: EMAIL, returnHost: new URL(redirect).host }).kind, kind);
  }
  const unregistered = await checkAuthorizeRequest({ ...base, redirect_uri: "https://claude.ai/other" }, urls, deps);
  assert.equal(unregistered.ok, false);
});

test("the registered name: control characters dropped, capped, untouched markup left for React to escape", () => {
  assert.equal(displayClientName("a\u0000b‮c\n d"), "abc d");
  const long = displayClientName("n".repeat(200))!;
  assert.equal([...long].length, CLIENT_NAME_MAX);
  assert.equal(long, `${"n".repeat(59)}…`);
  // In the sentence: “ + 59 characters + … + ”.
  const line = consentContent({ redirectUri: LOOP, clientName: "n".repeat(200), email: null, returnHost: "x" }).lines[0];
  assert.equal(line, `An app on this computer, calling itself “${"n".repeat(59)}…”, is asking to read Off/Pixel.`);
  // A name exactly at the cap is kept whole.
  assert.equal(displayClientName("m".repeat(60)), "m".repeat(60));
  assert.equal(displayClientName(`<script>alert("x")</script>`), `<script>alert("x")</script>`);
  assert.equal(displayClientName(null), null);
});

test("Cancel returns to the same redirect URI with error=access_denied, state and iss", async () => {
  const deps = makeDeps();
  const reg = await registerClient({ redirect_uris: [LOOP] }, deps);
  const params = {
    response_type: "code",
    client_id: (reg.body as { client_id: string }).client_id,
    redirect_uri: LOOP,
    code_challenge: pkceChallengeFor(VERIFIER),
    code_challenge_method: "S256",
    state: "st8",
  };
  const cancel = await decideConsentRequest(params, "deny", OPERATOR, urls, deps);
  assert.ok("redirectTo" in cancel);
  const back = new URL(cancel.redirectTo);
  assert.equal(`${back.origin}${back.pathname}`, LOOP);
  assert.equal(back.host, "localhost:53682", "the host the page named");
  assert.equal(back.searchParams.get("error"), "access_denied");
  assert.equal(back.searchParams.get("state"), "st8");
  assert.equal(back.searchParams.get("iss"), urls.issuer);
  assert.equal(back.searchParams.get("code"), null);

  const allow = await decideConsentRequest(params, "allow", OPERATOR, urls, deps);
  assert.ok("redirectTo" in allow);
  assert.match(new URL(allow.redirectTo).searchParams.get("code") ?? "", /^opx_code_/);
  assert.deepEqual(await decideConsentRequest(params, "allow", STRANGER, urls, deps), { refused: "not_operator" });
  assert.deepEqual(await decideConsentRequest(params, "allow", null, urls, deps), { refused: "signed_out" });
  assert.deepEqual(await decideConsentRequest({ ...params, client_id: "opx_client_nope" }, "allow", OPERATOR, urls, deps), { refused: "invalid_request" });
});

test("a connection dies after 30 days without use, and each use resets the 30 days", async () => {
  let now = new Date("2026-11-24T10:00:00Z");
  const deps = { ...makeDeps(), now: () => now };
  const { clientId, tokens } = await connect(deps);
  const refresh = (token: string) => exchangeToken(new URLSearchParams({ grant_type: "refresh_token", refresh_token: token, client_id: clientId }), urls, deps);

  // Used on day 29: works, and the new refresh token runs 30 days from then.
  now = new Date("2026-12-23T10:00:00Z");
  const r1 = await refresh(tokens.refresh_token);
  assert.equal(r1.status, 200);
  const next = (r1.body as { refresh_token: string }).refresh_token;

  // 29 more days idle: still alive (58 days since connecting).
  now = new Date("2027-01-21T10:00:00Z");
  const r2 = await refresh(next);
  assert.equal(r2.status, 200);
  const last = (r2.body as { refresh_token: string }).refresh_token;

  // Then 30 days and a second without use: invalid_grant.
  now = new Date("2027-02-20T10:00:01Z");
  const dead = await refresh(last);
  assert.equal(dead.status, 400);
  assert.equal((dead.body as { error: string }).error, "invalid_grant");
});

test("M2 words: a grant with drafts says use and design's line 2; a read grant adding drafts is the upgrade (words-mcp-consent-drafts-2026-11-24.tsv)", () => {
  const tsv = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures/words-mcp-consent-drafts-2026-11-24.tsv"), "utf8");
  const W = Object.fromEntries(tsv.trim().split("\n").slice(1).map((l) => l.split("\t")).map((c) => [c[0], c[2]]));
  const fillW = (k: string, v: Record<string, string>) => String(W[k]).replace(/\{([^{}]+)\}/g, (_, n: string) => v[n] ?? `{${n}}`);
  const DRAFTS = "mcp:read mcp:draft";
  const claude = { redirectUri: CLAUDE_CALLBACK, clientName: "Claude", email: EMAIL, returnHost: "claude.ai" };
  const plain = consentContent({ ...claude, scope: DRAFTS });
  assert.equal(plain.title, CONSENT_WORDS.titleClaude);
  assert.equal(plain.lines[0], fillW("consent.line1.drafts", { email: EMAIL }));
  assert.equal(plain.lines[1], W["consent.line2.drafts"]);
  assert.equal(plain.cancelNote, undefined);
  const up = consentContent({ ...claude, scope: DRAFTS, hasReadOnlyGrant: true });
  assert.equal(up.title, W["consent.title.upgrade"]);
  assert.equal(up.cancelNote, W["consent.upgrade.cancel_note"]);
  const loop = { redirectUri: LOOP, clientName: "Inspector", email: EMAIL, returnHost: "localhost:53682" };
  const lu = consentContent({ ...loop, scope: DRAFTS, hasReadOnlyGrant: true });
  assert.equal(lu.title, W["consent.title.upgrade.loopback"]);
  assert.equal(lu.lines[0], fillW("consent.line1.drafts.loopback", { "client name": "Inspector", email: EMAIL }));
  assert.equal(consentContent({ ...loop, clientName: null, scope: DRAFTS }).lines[0], fillW("consent.line1.drafts.loopback.unnamed", { email: EMAIL }));
  // A read-only request keeps every M1 word, with or without an existing grant.
  assert.deepEqual(consentContent({ ...claude, scope: "mcp:read", hasReadOnlyGrant: true }), consentContent(claude));
  // Lines 3 and 4 never change.
  assert.deepEqual([up.lines[2], up.lines[3]], [consentContent(claude).lines[2], consentContent(claude).lines[3]]);
  // Every word in the list is used.
  for (const k of Object.keys(W)) assert.ok(k.startsWith("consent."), k);
  assert.equal(Object.keys(W).length, 7);
});
