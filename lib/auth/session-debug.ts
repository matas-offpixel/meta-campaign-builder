import type { Session, User } from "@supabase/supabase-js";

/**
 * Safe summary for logs / support — no raw tokens.
 */
export function summarizeSessionForDebug(session: Session | null): Record<string, unknown> {
  if (!session) return { hasSession: false };

  return {
    hasSession: true,
    userId: session.user?.id,
    expires_at: session.expires_at,
    provider_token: session.provider_token
      ? { present: true, length: session.provider_token.length }
      : { present: false },
    provider_refresh_token: session.provider_refresh_token
      ? { present: true, length: session.provider_refresh_token.length }
      : { present: false },
    identities: session.user?.identities?.map((i) => ({
      provider: i.provider,
      identity_id: i.identity_id,
      id: i.id,
    })),
    app_metadata_keys: session.user?.app_metadata ? Object.keys(session.user.app_metadata) : [],
    user_metadata_keys: session.user?.user_metadata ? Object.keys(session.user.user_metadata) : [],
  };
}

export function summarizeUserForDebug(user: User | null): Record<string, unknown> {
  if (!user) return { hasUser: false };
  return {
    hasUser: true,
    id: user.id,
    email: user.email,
    identities: user.identities?.map((i) => ({
      provider: i.provider,
      identity_id: i.identity_id,
      id: i.id,
    })),
  };
}
