import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CLAUDE_CALLBACK } from "../config.ts";
import { pkceChallengeFor } from "../crypto.ts";
import { checkAuthorizeRequest, decideConsentRequest, exchangeToken, registerClient } from "../oauth/flow.ts";
import { CLIENT_NAME_MAX, CONSENT_WORDS, consentContent, displayClientName, isUpgradeConsent, returnKindOf } from "../oauth/consent-words.ts";
import { checkBearer } from "../oauth/flow.ts";
import { createMemoryStore } from "../oauth/store.ts";
import { sha256Hex } from "../crypto.ts";
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

test("upgrade vs first connection: a live read-only grant from the SAME client, asking for drafts", () => {
  const read = { client_id: "c1", scope: "mcp:read", revoked_at: null };
  assert.equal(isUpgradeConsent([read], "c1", "mcp:read mcp:draft"), true);
  assert.equal(isUpgradeConsent([read], "c2", "mcp:read mcp:draft"), false, "another client's grant is a first connection");
  assert.equal(isUpgradeConsent([], "c1", "mcp:read mcp:draft"), false);
  assert.equal(isUpgradeConsent([{ ...read, scope: "mcp:read mcp:draft" }], "c1", "mcp:read mcp:draft"), false, "already has drafts");
  assert.equal(isUpgradeConsent([{ ...read, revoked_at: "2026-11-24T00:00:00Z" }], "c1", "mcp:read mcp:draft"), false, "revoked");
  assert.equal(isUpgradeConsent([read], "c1", "mcp:read"), false, "a read-only request is never an upgrade");
});

test("cancelling an upgrade keeps the read grant and its tokens: no new grant, code or token; access_denied with state and iss", async () => {
  const state = { clients: new Map(), grants: new Map(), codes: new Map(), tokens: new Map() };
  const deps = { ...makeDeps(), store: createMemoryStore(state as never) };
  const { clientId, tokens } = await connect(deps);
  assert.equal(tokens.scope, "mcp:read");
  const grantsBefore = structuredClone([...state.grants.values()]);
  const tokensBefore = structuredClone([...state.tokens.entries()]);
  const codesBefore = state.codes.size;

  const params = {
    response_type: "code",
    client_id: clientId,
    redirect_uri: CLAUDE_CALLBACK,
    code_challenge: pkceChallengeFor(VERIFIER),
    code_challenge_method: "S256",
    state: "up9rade",
    scope: "mcp:read mcp:draft",
    resource: urls.resource,
  };
  const check = await checkAuthorizeRequest(params, urls, deps);
  assert.ok(check.ok);
  assert.equal(isUpgradeConsent(await deps.store.listLiveGrants({ userId: OPERATOR }), clientId, check.request.scope), true, "this is the upgrade wording");

  const out = await decideConsentRequest(params, "deny", OPERATOR, urls, deps);
  assert.ok("redirectTo" in out);
  const back = new URL(out.redirectTo);
  assert.equal(`${back.origin}${back.pathname}`, CLAUDE_CALLBACK);
  assert.equal(back.searchParams.get("error"), "access_denied");
  assert.equal(back.searchParams.get("state"), "up9rade");
  assert.equal(back.searchParams.get("iss"), urls.issuer);
  assert.equal(back.searchParams.get("code"), null);

  // The store is exactly as it was: same grant row, same tokens, no new code.
  assert.deepEqual([...state.grants.values()], grantsBefore);
  assert.deepEqual([...state.tokens.entries()], tokensBefore);
  assert.equal(state.codes.size, codesBefore);

  // The old access token still reads; the old refresh token still refreshes.
  const bearer = await checkBearer(`Bearer ${tokens.access_token}`, urls, deps);
  assert.ok(bearer.ok && bearer.scope === "mcp:read");
  const refreshed = await exchangeToken(new URLSearchParams({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: clientId }), urls, deps);
  assert.equal(refreshed.status, 200);
  assert.equal((refreshed.body as { scope: string }).scope, "mcp:read");
  assert.ok(state.tokens.get(sha256Hex(tokens.refresh_token)));
});

test("allowing an upgrade leaves one live grant for the connection: the read grant is revoked once the new one is issued", async () => {
  const state = { clients: new Map(), grants: new Map(), codes: new Map(), tokens: new Map() };
  const deps = { ...makeDeps(), store: createMemoryStore(state as never) };
  const { clientId, tokens: old } = await connect(deps);
  const other = await connect(deps); // another connector of the same operator, read only
  assert.equal(old.scope, "mcp:read");
  const oldGrantId = [...state.grants.values()].find((g) => g.client_id === clientId)!.id;

  const params = {
    response_type: "code",
    client_id: clientId,
    redirect_uri: CLAUDE_CALLBACK,
    code_challenge: pkceChallengeFor(VERIFIER),
    code_challenge_method: "S256",
    state: "up9rade",
    scope: "mcp:read mcp:draft",
    resource: urls.resource,
  };
  const check = await checkAuthorizeRequest(params, urls, deps);
  assert.ok(check.ok);
  assert.equal(isUpgradeConsent(await deps.store.listLiveGrants({ userId: OPERATOR }), clientId, check.request.scope), true);

  const out = await decideConsentRequest(params, "allow", OPERATOR, urls, deps);
  assert.ok("redirectTo" in out);
  const code = new URL(out.redirectTo).searchParams.get("code")!;
  assert.ok(code);
  // Allow alone (a code not yet exchanged) leaves the read grant live.
  assert.equal(state.grants.get(oldGrantId)!.revoked_at, null);
  assert.ok((await checkBearer(`Bearer ${old.access_token}`, urls, deps)).ok);

  const tok = await exchangeToken(
    new URLSearchParams({ grant_type: "authorization_code", code, code_verifier: VERIFIER, client_id: clientId, redirect_uri: CLAUDE_CALLBACK, resource: urls.resource }),
    urls,
    deps,
  );
  assert.equal(tok.status, 200);
  const fresh = tok.body as { access_token: string; scope: string };
  assert.equal(fresh.scope, "mcp:read mcp:draft");

  // Exactly one live grant for this connection, and it is the new one.
  const live = await deps.store.listLiveGrants({ userId: OPERATOR });
  const mine = live.filter((g) => g.client_id === clientId);
  assert.equal(mine.length, 1);
  assert.equal(mine[0]!.scope, "mcp:read mcp:draft");
  assert.notEqual(mine[0]!.id, oldGrantId);
  assert.ok(state.grants.get(oldGrantId)!.revoked_at, "the read grant is revoked");

  // The old tokens stop working; the new one reads and drafts.
  assert.equal((await checkBearer(`Bearer ${old.access_token}`, urls, deps)).ok, false);
  const refresh = await exchangeToken(new URLSearchParams({ grant_type: "refresh_token", refresh_token: old.refresh_token, client_id: clientId }), urls, deps);
  assert.equal(refresh.status, 400);
  const bearer = await checkBearer(`Bearer ${fresh.access_token}`, urls, deps, "mcp:draft");
  assert.ok(bearer.ok);

  // Another client's grant is never touched.
  assert.equal(live.filter((g) => g.client_id === other.clientId).length, 1);
  assert.ok((await checkBearer(`Bearer ${other.tokens.access_token}`, urls, deps)).ok);
});

test("an upgrade whose revoke of the read grant fails is undone: 500, the new grant revoked, the read grant still the one live grant", async () => {
  const state = { clients: new Map(), grants: new Map(), codes: new Map(), tokens: new Map() };
  const base = createMemoryStore(state as never);
  let failRevokeOf: string | null = null;
  const store = {
    ...base,
    async revokeGrant(id: string, reason: never, nowIso: string) {
      if (id === failRevokeOf) throw new Error("revoke grant: connection reset");
      return base.revokeGrant(id, reason, nowIso);
    },
  };
  const deps = { ...makeDeps(), store };
  const { clientId, tokens: old } = await connect(deps);
  const oldGrantId = [...state.grants.values()].find((g) => g.client_id === clientId)!.id;
  failRevokeOf = oldGrantId;

  const params = {
    response_type: "code",
    client_id: clientId,
    redirect_uri: CLAUDE_CALLBACK,
    code_challenge: pkceChallengeFor(VERIFIER),
    code_challenge_method: "S256",
    state: "up9rade",
    scope: "mcp:read mcp:draft",
    resource: urls.resource,
  };
  const out = await decideConsentRequest(params, "allow", OPERATOR, urls, deps);
  assert.ok("redirectTo" in out);
  const code = new URL(out.redirectTo).searchParams.get("code")!;
  const tok = await exchangeToken(
    new URLSearchParams({ grant_type: "authorization_code", code, code_verifier: VERIFIER, client_id: clientId, redirect_uri: CLAUDE_CALLBACK, resource: urls.resource }),
    urls,
    deps,
  );
  assert.equal(tok.status, 500);
  assert.equal((tok.body as { error: string }).error, "server_error");
  assert.equal("access_token" in tok.body, false, "no token leaves on a failed exchange");

  const mine = (await deps.store.listLiveGrants({ userId: OPERATOR })).filter((g) => g.client_id === clientId);
  assert.equal(mine.length, 1, "never two live grants");
  assert.equal(mine[0]!.id, oldGrantId, "the read grant is the one left");
  const newGrant = [...state.grants.values()].find((g) => g.client_id === clientId && g.id !== oldGrantId)!;
  assert.ok(newGrant.revoked_at, "the new grant is revoked");
  assert.ok((await checkBearer(`Bearer ${old.access_token}`, urls, deps)).ok, "the read token still reads");
});

test("design's re-ruled consent rows (26 Nov verdict): the drafts permission now covers setting up shows, word for word", () => {
  assert.equal(
    CONSENT_WORDS.drafts,
    "It can read every client's events, spend, signup and ticket counts, drafts and learnings. It can also make events and clients, set a show's lineup and ticket releases, mark drops and whose footage clips are in the Lab, put files in a show's own Drive folders, and make, change and archive campaign drafts that aren't published, including adding creatives from Google Drive. It can't publish, launch or send anything.",
  );
  assert.equal(
    CONSENT_WORDS.meta,
    "It can read every client's events, spend, signup and ticket counts, drafts and learnings, make events and clients, set lineups, ticket releases and the Lab's drops and clip owners, put files in a show's own Drive folders, and make, change and archive campaign drafts. It can also send files to Meta, launch drafts paused or live, change live campaigns, make audiences (lookalikes too), ask artists' Facebook Pages for advertiser access from the client's own Business Manager, and change an event's dates and links, each only after you say yes in Claude. It can't start or raise spend past a show's spend ceiling, and every change is listed on Today.",
  );
  assert.equal(CONSENT_WORDS.titleUpgrade, "Let Claude change drafts and set up shows in Off/Pixel");
  assert.equal(CONSENT_WORDS.titleUpgradeLoopback, "Let an app on this computer change drafts and set up shows in Off/Pixel");
  // The consent lines keep straight apostrophes.
  for (const w of [CONSENT_WORDS.drafts, CONSENT_WORDS.meta]) assert.ok(!w.includes("’"), w);
  // settings.claude.scope.drafts (no screen renders it yet): both copies of TD's list carry the ruled row, with typographic apostrophes.
  const SCOPE_DRAFTS = "Drafts · make, change and archive drafts that aren’t published, and set up shows: events, clients, lineups, releases, Lab drops and clip owners, files in a show’s folders";
  const here = dirname(fileURLToPath(import.meta.url));
  for (const f of [join(here, "fixtures/words-mcp-today-2026-11-25.tsv"), join(here, "../../render-templates/__tests__/fixtures/words-mcp-today-2026-11-25.tsv")]) {
    const row = readFileSync(f, "utf8").split("\n").find((l) => l.startsWith("settings.claude.scope.drafts\t"));
    assert.equal(row?.split("\t")[2], SCOPE_DRAFTS, f);
  }
});
