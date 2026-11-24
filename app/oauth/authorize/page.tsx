/**
 * MCP OAuth consent (M1). Operator-only, plain on purpose: its words are
 * listed in the PR for design's verdict (Matas, 24 Nov).
 *
 * Public in the proxy (lib/auth/public-routes.ts) so a signed-out visit is
 * told why instead of losing the request in a /login bounce; the page and
 * its server action check the Supabase session and OPERATOR_USER_IDS
 * themselves. 404 unless ENABLE_MCP === "1".
 */
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { isOperator } from "@/lib/auth/operator-allowlist";
import { isMcpEnabled, mcpUrls } from "@/lib/mcp/config";
import { checkAuthorizeRequest } from "@/lib/mcp/oauth/flow";
import { flowDeps } from "@/lib/mcp/route-deps";
import { CONSENT_WORDS, consentBody } from "@/lib/mcp/oauth/consent-words";
import { decideConsent } from "./actions";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const PARAM_KEYS = ["response_type", "client_id", "redirect_uri", "code_challenge", "code_challenge_method", "state", "scope", "resource"] as const;

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-5 px-4 py-10">
      <h1 className="text-xl font-semibold">{CONSENT_WORDS.title}</h1>
      {children}
    </main>
  );
}

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
  if (!check.ok) {
    return (
      <Shell>
        <p>{CONSENT_WORDS.invalid}</p>
      </Shell>
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return (
      <Shell>
        <p>{CONSENT_WORDS.signedOut}</p>
        <a className="underline" href="/login">
          {CONSENT_WORDS.signIn}
        </a>
      </Shell>
    );
  }
  if (!isOperator(user.id)) {
    return (
      <Shell>
        <p>{CONSENT_WORDS.notOperator}</p>
      </Shell>
    );
  }

  const req = check.request;
  const body = consentBody({
    clientName: req.client.client_name,
    email: user.email ?? null,
    returnHost: new URL(req.redirectUri).host,
  });
  return (
    <Shell>
      {body.map((line) => (
        <p key={line}>{line}</p>
      ))}
      <form action={decideConsent} className="flex gap-3">
        {PARAM_KEYS.map((k) => (params[k] != null ? <input key={k} type="hidden" name={k} value={params[k]} /> : null))}
        <button type="submit" name="decision" value="allow" className="rounded bg-black px-4 py-2 text-white dark:bg-white dark:text-black">
          {CONSENT_WORDS.allow}
        </button>
        <button type="submit" name="decision" value="deny" className="rounded border px-4 py-2">
          {CONSENT_WORDS.cancel}
        </button>
      </form>
    </Shell>
  );
}
