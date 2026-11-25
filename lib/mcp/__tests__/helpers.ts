import assert from "node:assert/strict";
import { CLAUDE_CALLBACK, mcpUrls } from "../config.ts";
import { pkceChallengeFor } from "../crypto.ts";
import { checkAuthorizeRequest, exchangeToken, issueCode, registerClient, type FlowDeps } from "../oauth/flow.ts";
import { createMemoryStore } from "../oauth/store.ts";

export const OPERATOR = "b3ee4e5c-44e6-4684-acf6-efefbecd5858";
export const STAFF = "4aa59005-5c1d-495c-8029-8c9453950c4d";
export const STRANGER = "00000000-0000-4000-8000-000000000001";
export const ORIGIN = "https://app.offpixel.co.uk";
export const urls = mcpUrls(ORIGIN);
export const VERIFIER = "v".repeat(20) + "-._~" + "A1".repeat(12);

export function makeDeps(operators = new Set([OPERATOR])): FlowDeps & { operators: Set<string> } {
  return { store: createMemoryStore(), isOperator: (id) => operators.has(id), operators };
}

export async function connect(deps: FlowDeps, userId = OPERATOR, redirect = CLAUDE_CALLBACK, scope?: string) {
  const reg = await registerClient({ client_name: "Claude", redirect_uris: [redirect] }, deps);
  assert.equal(reg.status, 201);
  const clientId = String((reg.body as { client_id: string }).client_id);
  const check = await checkAuthorizeRequest(
    {
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirect,
      code_challenge: pkceChallengeFor(VERIFIER),
      code_challenge_method: "S256",
      state: "st4te",
      resource: urls.resource,
      ...(scope ? { scope } : {}),
    },
    urls,
    deps,
  );
  assert.ok(check.ok);
  const issued = await issueCode(check.request, userId, urls, deps);
  assert.ok(issued.ok);
  const back = new URL(issued.redirectTo);
  assert.equal(back.searchParams.get("state"), "st4te");
  assert.equal(back.searchParams.get("iss"), urls.issuer);
  const code = back.searchParams.get("code")!;
  const tok = await exchangeToken(
    new URLSearchParams({ grant_type: "authorization_code", code, code_verifier: VERIFIER, client_id: clientId, redirect_uri: redirect, resource: urls.resource }),
    urls,
    deps,
  );
  assert.equal(tok.status, 200);
  return { clientId, code, tokens: tok.body as { access_token: string; refresh_token: string; expires_in: number; scope: string } };
}

