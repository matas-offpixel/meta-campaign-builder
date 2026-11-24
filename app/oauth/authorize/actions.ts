"use server";

/**
 * The consent decision. decideConsentRequest re-checks everything the page
 * checked (the request, the session, OPERATOR_USER_IDS) before a code is
 * issued; Cancel sends error=access_denied back to the same redirect URI.
 */
import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { isMcpEnabled, mcpUrls } from "@/lib/mcp/config";
import { decideConsentRequest } from "@/lib/mcp/oauth/flow";
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
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const decision = form.get("decision");
  const out = await decideConsentRequest(params, typeof decision === "string" ? decision : null, user?.id ?? null, mcpUrls(`${proto}://${host}`), flowDeps());
  if ("redirectTo" in out) redirect(out.redirectTo);
  notFound();
}
