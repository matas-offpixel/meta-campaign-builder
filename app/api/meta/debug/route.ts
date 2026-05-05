/**
 * GET /api/meta/debug
 *
 * Diagnostic route — verifies the server-side Meta token is present and
 * working by running several Graph API calls and returning their results.
 * Also performs a real test-image upload to /{META_AD_ACCOUNT_ID}/adimages
 * so you can see the exact Meta error without going through the UI.
 *
 * Protected by Supabase session (same as every other /api/meta/* route).
 * Only intended for development / troubleshooting.
 */

import { withActPrefix } from "@/lib/meta/ad-account-id";
import { createClient } from "@/lib/supabase/server";

const API_VERSION = process.env.META_API_VERSION ?? "v21.0";
const BASE = `https://graph.facebook.com/${API_VERSION}`;

// 1×1 red pixel PNG — smallest valid image we can submit to Meta.
const MINIMAL_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg==";

interface TestResult {
  label: string;
  ok: boolean;
  status?: number;
  data?: unknown;
  error?: string;
}

async function probe(label: string, url: string): Promise<TestResult> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    const json = (await res.json()) as Record<string, unknown>;

    if (!res.ok || json.error) {
      const e = (json.error ?? {}) as Record<string, unknown>;
      return {
        label,
        ok: false,
        status: res.status,
        error: String(e.message ?? json.error ?? `HTTP ${res.status}`),
        data: json,
      };
    }

    return { label, ok: true, status: res.status, data: json };
  } catch (err) {
    return { label, ok: false, error: String(err) };
  }
}

async function probeUpload(
  label: string,
  adAccountId: string,
  token: string,
): Promise<TestResult> {
  try {
    // Decode the test PNG into a Blob
    const binary = Buffer.from(MINIMAL_PNG_B64, "base64");
    const blob = new Blob([binary], { type: "image/png" });

    const fd = new FormData();
    // Mirror the exact field names used by uploadImageAsset()
    fd.append("access_token", token);
    fd.append("filename", blob, "debug_test.png");

    // Token is in the form body, not the URL — matches uploadImageAsset() exactly.
    const url = `${BASE}/${withActPrefix(adAccountId)}/adimages`;
    const res = await fetch(url, { method: "POST", body: fd });
    const json = (await res.json()) as Record<string, unknown>;

    if (!res.ok || json.error) {
      const e = (json.error ?? {}) as Record<string, unknown>;
      return {
        label,
        ok: false,
        status: res.status,
        error: String(e.message ?? `HTTP ${res.status}`),
        data: json,
      };
    }

    return { label, ok: true, status: res.status, data: json };
  } catch (err) {
    return { label, ok: false, error: String(err) };
  }
}

export async function GET() {
  // ── Auth ─────────────────────────────────────────────────────────────────
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Unauthorised" }, { status: 401 });
  }

  // ── Env vars ─────────────────────────────────────────────────────────────
  const token = process.env.META_ACCESS_TOKEN;
  const adAccountId = process.env.META_AD_ACCOUNT_ID;
  const apiVersion = process.env.META_API_VERSION ?? "(not set — defaulting to v21.0)";

  const env = {
    META_API_VERSION: apiVersion,
    META_AD_ACCOUNT_ID: adAccountId ?? "(NOT SET)",
    META_ACCESS_TOKEN: token
      ? `${token.slice(0, 12)}…${token.slice(-6)} (${token.length} chars)`
      : "(NOT SET)",
    token_present: !!token,
    ad_account_present: !!adAccountId,
  };

  if (!token) {
    return Response.json(
      {
        env,
        error:
          "META_ACCESS_TOKEN is missing from process.env. " +
          "Ensure it is in .env.local and that the dev server was restarted after editing the file.",
      },
      { status: 500 },
    );
  }

  // ── Run diagnostic probes ────────────────────────────────────────────────
  const results: TestResult[] = [];

  // 1. Token introspection — validity, expiry, scopes, app ID
  results.push(
    await probe(
      "Token introspection (/debug_token)",
      `https://graph.facebook.com/debug_token?input_token=${token}&access_token=${token}`,
    ),
  );

  // 2. /me — confirms the token resolves to a real user
  results.push(
    await probe(
      "Token identity (/me)",
      `${BASE}/me?fields=id,name&access_token=${token}`,
    ),
  );

  // 3. /me/adaccounts — same call as fetchAdAccounts()
  results.push(
    await probe(
      "Ad accounts (/me/adaccounts)",
      `${BASE}/me/adaccounts?fields=id,name,account_id,account_status&limit=10&access_token=${token}`,
    ),
  );

  if (adAccountId) {
    const accountPath = withActPrefix(adAccountId);
    // 4. Ad account detail — confirms access to the specific account from env
    results.push(
      await probe(
        `Ad account detail (/${accountPath})`,
        `${BASE}/${accountPath}?fields=id,name,account_status,business&access_token=${token}`,
      ),
    );

    // 5. Pages — same call as fetchPages()
    results.push(
      await probe(
        "Pages (/me/accounts)",
        `${BASE}/me/accounts?fields=id,name,fan_count,category&limit=100&access_token=${token}`,
      ),
    );

    // 6. GET /adimages — confirms ads_read on the account
    results.push(
      await probe(
        `Ad images list — GET (/${accountPath}/adimages)`,
        `${BASE}/${accountPath}/adimages?fields=hash,url&limit=100&access_token=${token}`,
      ),
    );

    // 7. POST /adimages with a 1×1 PNG — confirms ads_management + real upload path
    //    This uses the EXACT same code path as the production upload (no cache option).
    results.push(
      await probeUpload(
        `Test image upload — POST (/${accountPath}/adimages)`,
        adAccountId,
        token,
      ),
    );
  } else {
    results.push({
      label: "Ad account tests (skipped)",
      ok: false,
      error: "META_AD_ACCOUNT_ID is not set in .env.local — add it to test account-scoped endpoints.",
    });
  }

  const allOk = results.every((r) => r.ok);

  return Response.json(
    {
      env,
      allOk,
      results,
      summary: allOk
        ? "✓ All checks passed. Token is valid and the upload path works."
        : `✗ ${results.filter((r) => !r.ok).length} check(s) failed — see results for details.`,
    },
    { status: allOk ? 200 : 502 },
  );
}
