"use server";

/**
 * The consent decision. Re-checks everything the page checked (the
 * request, the session, OPERATOR_USER_IDS) before a code is issued; a
 * Cancel sends access_denied back to the client.
 */
import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { isMcpEnabled, mcpUrls } from "@/lib/mcp/config";
import { checkAuthorizeRequest, errorRedirect, issueCode } from "@/lib/mcp/oauth/flow";
import { flowDeps } from "@/lib/mcp/route-deps";

const PARAM_KEYS = ["response_type", "client_id", "redirect_uri", "code_challenge", "code_challenge_method", "state", "scope", "resource"] as const;

export async function decideConsent(form: FormData): Promise<void> {
  if (!isMcpEnabled()) notFound();
  const params: Record<string, string | undefined> = {};
  for (const k of PARAM_KEYS) {
    const v = form.get(k);
    params[k] = typeof v === "string" ? v : undefined;
  }
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  const urls = mcpUrls(`${proto}://${host}`);
  const deps = flowDeps();
  const check = await checkAuthorizeRequest(params, urls, deps);
  if (!check.ok) {
    if (check.kind === "redirect") redirect(check.redirectTo);
    notFound();
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();
  if (form.get("decision") !== "allow") {
    redirect(errorRedirect(check.request.redirectUri, "access_denied", check.request.state, urls.issuer));
  }
  const issued = await issueCode(check.request, user.id, urls, deps);
  if (!issued.ok) notFound();
  redirect(issued.redirectTo);
}
