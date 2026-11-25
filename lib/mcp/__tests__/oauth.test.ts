import { test } from "node:test";
import assert from "node:assert/strict";
import { CLAUDE_CALLBACK, mcpUrls } from "../config.ts";
import { pkceChallengeFor, sha256Hex } from "../crypto.ts";
import {
  checkAuthorizeRequest,
  checkBearer,
  exchangeToken,
  isAllowedRedirectUri,
  issueCode,
  redirectUriMatches,
  registerClient,
  resolveScope,
  revokeToken,
} from "../oauth/flow.ts";
import { OPERATOR, STRANGER, VERIFIER, connect, makeDeps, urls } from "./helpers.ts";

test("registration takes only Claude's callback or loopback", async () => {
  const deps = makeDeps();
  assert.equal(isAllowedRedirectUri(CLAUDE_CALLBACK), true);
  assert.equal(isAllowedRedirectUri("http://localhost:3118/callback"), true);
  assert.equal(isAllowedRedirectUri("http://127.0.0.1:9/cb"), true);
  for (const bad of ["https://evil.example/cb", "https://claude.ai/other", "http://localhost.evil.com/cb", "https://localhost/cb", "javascript:alert(1)"]) {
    assert.equal(isAllowedRedirectUri(bad), false, bad);
    const out = await registerClient({ redirect_uris: [bad] }, deps);
    assert.equal(out.status, 400, bad);
  }
  const secretClient = await registerClient({ redirect_uris: [CLAUDE_CALLBACK], token_endpoint_auth_method: "client_secret_basic" }, deps);
  assert.equal(secretClient.status, 400);
});

test("loopback redirect matches on any port, nothing else does", () => {
  assert.equal(redirectUriMatches(["http://localhost:3118/callback"], "http://localhost:51234/callback"), true);
  assert.equal(redirectUriMatches(["http://localhost:3118/callback"], "http://localhost:51234/other"), false);
  assert.equal(redirectUriMatches([CLAUDE_CALLBACK], `${CLAUDE_CALLBACK}?x=1`), false);
});

test("scopes: mcp:read and mcp:draft (always with read); offline_access ignored; mcp:meta and others refused", () => {
  assert.equal(resolveScope(undefined), "mcp:read");
  assert.equal(resolveScope("mcp:read offline_access"), "mcp:read");
  assert.equal(resolveScope("mcp:meta"), null);
  assert.equal(resolveScope("mcp:read mcp:meta"), null);
  assert.equal(resolveScope("mcp:draft"), "mcp:read mcp:draft");
  assert.equal(resolveScope("mcp:draft mcp:read offline_access"), "mcp:read mcp:draft");
});

test("authorize: unknown client and wrong redirect never redirect; bad PKCE method redirects with an error", async () => {
  const deps = makeDeps();
  assert.deepEqual(await checkAuthorizeRequest({ client_id: "opx_client_nope" }, urls, deps), { ok: false, kind: "fatal", reason: "unknown_client" });
  const reg = await registerClient({ redirect_uris: [CLAUDE_CALLBACK] }, deps);
  const clientId = (reg.body as { client_id: string }).client_id;
  const wrong = await checkAuthorizeRequest({ client_id: clientId, redirect_uri: "https://evil.example/cb" }, urls, deps);
  assert.equal(wrong.ok, false);
  assert.equal(!wrong.ok && wrong.kind, "fatal");
  const plain = await checkAuthorizeRequest(
    { client_id: clientId, redirect_uri: CLAUDE_CALLBACK, response_type: "code", code_challenge: "x".repeat(43), code_challenge_method: "plain" },
    urls,
    deps,
  );
  assert.equal(!plain.ok && plain.kind === "redirect" && new URL(plain.redirectTo).searchParams.get("error"), "invalid_request");
  const otherResource = await checkAuthorizeRequest(
    { client_id: clientId, redirect_uri: CLAUDE_CALLBACK, response_type: "code", code_challenge: "x".repeat(43), code_challenge_method: "S256", resource: "https://other.example/api/mcp" },
    urls,
    deps,
  );
  assert.equal(!otherResource.ok && otherResource.kind === "redirect" && new URL(otherResource.redirectTo).searchParams.get("error"), "invalid_target");
});

test("a non-operator gets no code", async () => {
  const deps = makeDeps();
  const reg = await registerClient({ redirect_uris: [CLAUDE_CALLBACK] }, deps);
  const check = await checkAuthorizeRequest(
    {
      client_id: (reg.body as { client_id: string }).client_id,
      redirect_uri: CLAUDE_CALLBACK,
      response_type: "code",
      code_challenge: pkceChallengeFor(VERIFIER),
      code_challenge_method: "S256",
    },
    urls,
    deps,
  );
  assert.ok(check.ok);
  assert.deepEqual(await issueCode(check.request, STRANGER, urls, deps), { ok: false, reason: "not_operator" });
});

test("code exchange: PKCE, one use, tokens stored hashed only", async () => {
  const deps = makeDeps();
  const { clientId, code, tokens } = await connect(deps);
  assert.match(tokens.access_token, /^opx_at_/);
  assert.match(tokens.refresh_token, /^opx_rt_/);
  assert.equal(tokens.expires_in, 3600);
  assert.equal(tokens.scope, "mcp:read");
  // Stored by hash; the plaintext is nowhere in the store.
  assert.ok(await deps.store.getToken(sha256Hex(tokens.access_token)));
  assert.equal(await deps.store.getToken(tokens.access_token), null);
  // The same code twice fails.
  const again = await exchangeToken(
    new URLSearchParams({ grant_type: "authorization_code", code, code_verifier: VERIFIER, client_id: clientId, redirect_uri: CLAUDE_CALLBACK }),
    urls,
    deps,
  );
  assert.equal(again.status, 400);
});

test("code exchange fails with the wrong verifier", async () => {
  const deps = makeDeps();
  const reg = await registerClient({ redirect_uris: [CLAUDE_CALLBACK] }, deps);
  const clientId = (reg.body as { client_id: string }).client_id;
  const check = await checkAuthorizeRequest(
    { client_id: clientId, redirect_uri: CLAUDE_CALLBACK, response_type: "code", code_challenge: pkceChallengeFor(VERIFIER), code_challenge_method: "S256" },
    urls,
    deps,
  );
  assert.ok(check.ok);
  const issued = await issueCode(check.request, OPERATOR, urls, deps);
  assert.ok(issued.ok);
  const code = new URL(issued.redirectTo).searchParams.get("code")!;
  const out = await exchangeToken(
    new URLSearchParams({ grant_type: "authorization_code", code, code_verifier: "w".repeat(50), client_id: clientId, redirect_uri: CLAUDE_CALLBACK }),
    urls,
    deps,
  );
  assert.equal(out.status, 400);
  assert.equal((out.body as { error: string }).error, "invalid_grant");
});

test("expired code fails", async () => {
  let now = new Date("2026-11-24T10:00:00Z");
  const deps = { ...makeDeps(), now: () => now };
  const reg = await registerClient({ redirect_uris: [CLAUDE_CALLBACK] }, deps);
  const clientId = (reg.body as { client_id: string }).client_id;
  const check = await checkAuthorizeRequest(
    { client_id: clientId, redirect_uri: CLAUDE_CALLBACK, response_type: "code", code_challenge: pkceChallengeFor(VERIFIER), code_challenge_method: "S256" },
    urls,
    deps,
  );
  assert.ok(check.ok);
  const issued = await issueCode(check.request, OPERATOR, urls, deps);
  assert.ok(issued.ok);
  now = new Date("2026-11-24T10:06:00Z");
  const out = await exchangeToken(
    new URLSearchParams({ grant_type: "authorization_code", code: new URL(issued.redirectTo).searchParams.get("code")!, code_verifier: VERIFIER, client_id: clientId, redirect_uri: CLAUDE_CALLBACK }),
    urls,
    deps,
  );
  assert.equal(out.status, 400);
});

test("refresh rotates; reusing the old refresh token revokes the grant", async () => {
  const deps = makeDeps();
  const { clientId, tokens } = await connect(deps);
  const r1 = await exchangeToken(new URLSearchParams({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: clientId }), urls, deps);
  assert.equal(r1.status, 200);
  const fresh = r1.body as { access_token: string; refresh_token: string };
  assert.notEqual(fresh.refresh_token, tokens.refresh_token);
  assert.equal((await checkBearer(`Bearer ${fresh.access_token}`, urls, deps)).ok, true);

  const reuse = await exchangeToken(new URLSearchParams({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: clientId }), urls, deps);
  assert.equal(reuse.status, 400);
  // The whole grant is gone: the new access token and refresh token too.
  assert.equal((await checkBearer(`Bearer ${fresh.access_token}`, urls, deps)).ok, false);
  const after = await exchangeToken(new URLSearchParams({ grant_type: "refresh_token", refresh_token: fresh.refresh_token, client_id: clientId }), urls, deps);
  assert.equal(after.status, 400);
});

test("bearer: no token / wrong token / revoked / expired → 401; removed operator → 403", async () => {
  let now = new Date("2026-11-24T10:00:00Z");
  const base = makeDeps();
  const deps = { ...base, now: () => now };
  const { tokens } = await connect(deps);
  assert.deepEqual(await checkBearer(null, urls, deps), { ok: false, status: 401, error: "invalid_request" });
  assert.deepEqual(await checkBearer("Bearer opx_at_wrong", urls, deps), { ok: false, status: 401, error: "invalid_token" });
  const ok = await checkBearer(`Bearer ${tokens.access_token}`, urls, deps);
  assert.equal(ok.ok, true);
  // Another resource (audience) is refused.
  assert.equal((await checkBearer(`Bearer ${tokens.access_token}`, mcpUrls("https://other.example"), deps)).ok, false);
  // Removed from OPERATOR_USER_IDS: 403 on the next call.
  base.operators.delete(OPERATOR);
  assert.deepEqual(await checkBearer(`Bearer ${tokens.access_token}`, urls, deps), { ok: false, status: 403, error: "forbidden" });
  base.operators.add(OPERATOR);
  // Expired after an hour.
  now = new Date("2026-11-24T11:00:01Z");
  assert.deepEqual(await checkBearer(`Bearer ${tokens.access_token}`, urls, deps), { ok: false, status: 401, error: "invalid_token" });
});

test("revocation endpoint kills the grant behind either token", async () => {
  const deps = makeDeps();
  const { clientId, tokens } = await connect(deps);
  await revokeToken(new URLSearchParams({ token: tokens.refresh_token }), deps);
  assert.deepEqual(await checkBearer(`Bearer ${tokens.access_token}`, urls, deps), { ok: false, status: 401, error: "invalid_token" });
  const refresh = await exchangeToken(new URLSearchParams({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: clientId }), urls, deps);
  assert.equal(refresh.status, 400);
});

test("refresh for a user removed from the list fails and revokes", async () => {
  const deps = makeDeps();
  const { clientId, tokens } = await connect(deps);
  deps.operators.delete(OPERATOR);
  const out = await exchangeToken(new URLSearchParams({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: clientId }), urls, deps);
  assert.equal(out.status, 400);
  deps.operators.add(OPERATOR);
  assert.equal((await checkBearer(`Bearer ${tokens.access_token}`, urls, deps)).ok, false);
});
