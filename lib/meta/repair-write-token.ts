/**
 * lib/meta/repair-write-token.ts
 *
 * task #128 continued — the repair script's WRITE pass (POST /adimages +
 * POST /{creativeId}) was failing all 42 targets with Meta error code=3
 * "Application does not have the capability to make this API call". Root
 * cause: `scripts/repair-video-thumbnails.mjs` used `META_ACCESS_TOKEN` (the
 * system app token — an app still in App Review, task #90) for every call,
 * including writes. The wizard's own launch path never hits this: every
 * write in `app/api/meta/launch-campaign/route.ts` resolves the operator's
 * personal Facebook OAuth token from `user_facebook_tokens` first (see
 * `resolveServerMetaToken` in `lib/meta/server-token.ts`) and only falls
 * back to the env token as a last resort. Discovery READS work fine on the
 * system token even in dev mode (Meta only gates WRITE capabilities during
 * App Review) — this module's fix only changes which token backs writes.
 *
 * This module is the canonical, unit-tested logic behind the repair
 * script's write-token resolution; `scripts/repair-video-thumbnails.mjs`
 * mirrors it inline (same convention as `isMetaPlaceholderThumbnailUrl` /
 * `isMetaPlaceholderThumbnailImage` in `lib/meta/video-thumbnail-poll.ts`)
 * so the plain `.mjs` script doesn't need a TS loader.
 *
 * Deliberately simpler than `resolveServerMetaToken`: this is a single-
 * operator admin script (not a per-request web handler), so there's no
 * `userId` to filter by — it just takes the freshest non-null
 * `provider_token` row in `user_facebook_tokens` (ordered by `expires_at`
 * desc), matching the task's "single-user setup (Matas)" framing.
 */

// ─── Minimal Supabase query shape (mockable without the full client type) ───
//
// Mirrors exactly the fluent chain this module calls:
//   supabase.from("user_facebook_tokens")
//     .select("user_id, provider_token, updated_at, expires_at")
//     .not("provider_token", "is", null)
//     .order("expires_at", { ascending: false, nullsFirst: false })
//     .limit(1)
//     .maybeSingle()

export interface UserFacebookTokenRow {
  user_id?: string | null;
  provider_token: string | null;
  updated_at?: string | null;
  expires_at?: string | null;
}

export interface UserFacebookTokensQueryResult {
  data: UserFacebookTokenRow | null;
  error: { message: string } | null;
}

export interface UserFacebookTokensTable {
  select: (columns: string) => {
    not: (column: string, operator: string, value: unknown) => {
      order: (
        column: string,
        options: { ascending: boolean; nullsFirst?: boolean },
      ) => {
        limit: (count: number) => {
          maybeSingle: () => Promise<UserFacebookTokensQueryResult>;
        };
      };
    };
  };
}

export interface SupabaseLike {
  from: (table: "user_facebook_tokens") => UserFacebookTokensTable;
}

// ─── Write token resolution ───────────────────────────────────────────────

export type WriteTokenSource = "override" | "user_facebook_token" | "env";

export interface ResolvedWriteToken {
  token: string;
  source: WriteTokenSource;
  /** ISO string from the DB row; null for override/env sources or rows with no recorded expiry. */
  expiresAt: string | null;
}

/**
 * Resolves the token that should back Meta WRITE calls (POST /adimages,
 * POST /{creativeId}), in priority order:
 *   1. `overrideToken` — the script's `--token=<...>` CLI arg, for one-off
 *      testing without touching Supabase.
 *   2. The freshest `user_facebook_tokens` row with a non-null
 *      `provider_token` (single-operator setup — no `userId` filter).
 *   3. `envToken` (`META_ACCESS_TOKEN`) — last resort. Logged distinctly
 *      because it's the exact path that produces Meta code=3 under App
 *      Review dev mode.
 *
 * @throws if none of the three sources yields a token.
 */
export async function resolveWriteToken(
  supabase: SupabaseLike,
  envToken: string | undefined,
  overrideToken?: string,
): Promise<ResolvedWriteToken> {
  if (overrideToken) {
    return { token: overrideToken, source: "override", expiresAt: null };
  }

  try {
    const { data, error } = await supabase
      .from("user_facebook_tokens")
      .select("user_id, provider_token, updated_at, expires_at")
      .not("provider_token", "is", null)
      .order("expires_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();

    if (!error && data?.provider_token) {
      return { token: data.provider_token, source: "user_facebook_token", expiresAt: data.expires_at ?? null };
    }
  } catch {
    // Fall through to the env fallback below — a DB hiccup shouldn't hard-fail the script.
  }

  if (envToken) {
    return { token: envToken, source: "env", expiresAt: null };
  }

  throw new Error(
    "No Meta write token available: no user_facebook_tokens row with a provider_token, " +
      "and META_ACCESS_TOKEN is not set. Connect Facebook in Account Setup, or pass --token=<user OAuth token>.",
  );
}

/** The exact startup log line the task asked for, given a resolved write token. */
export function describeWriteTokenSource(resolved: ResolvedWriteToken): string {
  if (resolved.source === "override") {
    return "source=override (--token flag)";
  }
  if (resolved.source === "user_facebook_token") {
    return `source=user_facebook_token (expires ${resolved.expiresAt ?? "unknown"})`;
  }
  return "source=env META_ACCESS_TOKEN (dev-mode risk)";
}

// ─── Meta error code=3 detection ("does not have the capability") ──────────

/** Printed alongside any write failure classified by {@link isMetaMissingCapabilityError}. */
export const MISSING_CAPABILITY_HINT =
  "Meta app not authorised for /adimages write — check META_ACCESS_TOKEN scope or run with --token=<user OAuth token>.";

/**
 * Duck-types a Meta Graph API write failure as error code=3 ("Application
 * does not have the capability to make this API call") — the exact
 * signature of a system/app token hitting a write edge the app hasn't been
 * approved for in App Review. Accepts either a structured `{ code }` error
 * (this module's own write helpers attach `.code`) or a plain `Error` whose
 * message still carries Meta's `(#3)` / capability wording, so it degrades
 * gracefully against errors from elsewhere in the codebase too.
 */
export function isMetaMissingCapabilityError(err: unknown): boolean {
  const code = (err as { code?: unknown } | null | undefined)?.code;
  if (code === 3) return true;

  const message = err instanceof Error ? err.message : String(err ?? "");
  return /\(#3\)/.test(message) || /does not have the capability/i.test(message);
}
