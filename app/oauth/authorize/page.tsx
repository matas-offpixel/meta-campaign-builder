/**
 * MCP OAuth consent (M1). Operator-only, plain on purpose: design rules the
 * words (consent-words.ts) before merge.
 *
 * Public in the proxy (lib/auth/public-routes.ts) so a signed-out visit is
 * told why instead of losing the request in a /login bounce; the page and
 * its server action check the Supabase session and OPERATOR_USER_IDS
 * themselves. 404 unless ENABLE_MCP === "1". The wording follows the
 * redirect URI the request carries (Claude's callback or loopback).
 */
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { isOperator } from "@/lib/auth/operator-allowlist";
import { isMcpEnabled, mcpUrls } from "@/lib/mcp/config";
import { checkAuthorizeRequest } from "@/lib/mcp/oauth/flow";
import { flowDeps } from "@/lib/mcp/route-deps";
import { consentContent } from "@/lib/mcp/oauth/consent-words";
import { ConsentView } from "@/components/mcp/consent-view";
import { decideConsent } from "./actions";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const PARAM_KEYS = ["response_type", "client_id", "redirect_uri", "code_challenge", "code_challenge_method", "state", "scope", "resource"] as const;

async function originFromHeaders(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  return `${proto}://${host}`;
}

export default async function AuthorizePage({ searchParams }: { searchParams: SearchParams }) {
  if (!isMcpEnabled()) notFound();
  const raw = await searchParams;
  const params: Record<string, string | undefined> = {};
  for (const k of PARAM_KEYS) {
    const v = raw[k];
    params[k] = Array.isArray(v) ? v[0] : v;
  }
  const urls = mcpUrls(await originFromHeaders());
  const check = await checkAuthorizeRequest(params, urls, flowDeps());
  // A bad client or redirect URI, or a malformed request: never redirect from here.
  if (!check.ok) return <ConsentView view={{ state: "invalid" }} />;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return <ConsentView view={{ state: "signed_out" }} />;
  if (!isOperator(user.id)) return <ConsentView view={{ state: "not_operator" }} />;

  const req = check.request;
  const content = consentContent({
    redirectUri: req.redirectUri,
    clientName: req.client.client_name,
    email: user.email ?? null,
    returnHost: new URL(req.redirectUri).host,
  });
  return (
    <ConsentView
      view={{ state: "consent", content }}
      action={decideConsent}
      hidden={PARAM_KEYS.map((k) => (params[k] != null ? <input key={k} type="hidden" name={k} value={params[k]} /> : null))}
    />
  );
}
