/**
 * lib/dashboard/presale/names.ts
 *
 * "entered by {name}, {date}" (design's ruling on #1255): entered_by stays
 * an auth user id in migration 249; the read helper turns each id into the
 * person's first name. The name is displayName's (the ruling on #1220):
 * the profile's first name, else the email's local part, never the email.
 *
 * The default lookup is the auth admin API, which only the service role
 * can call. With any other client the lookup fails quietly and the name
 * reads null ("entered {date}"); a caller can pass its own lookup.
 *
 * Relative imports only: the `node --test` runner can't resolve `@/`.
 */

import { displayName } from "../../onsale-refresh/line-states.ts";
import type { EnteredNames } from "./model.ts";

export type NameLookup = (userId: string) => Promise<string | null>;

type AdminAuth = {
  auth?: {
    admin?: {
      getUserById?: (id: string) => Promise<{ data: { user: { email?: string | null; user_metadata?: Record<string, unknown> | null } | null } | null; error: unknown }>;
    };
  };
};

/** The auth admin lookup on this client, or null when it has none. */
export function adminNameLookup(db: unknown): NameLookup | null {
  const admin = (db as AdminAuth | null)?.auth?.admin;
  if (!admin?.getUserById) return null;
  const getUserById = admin.getUserById.bind(admin);
  return async (userId) => {
    const { data, error } = await getUserById(userId);
    if (error || !data?.user) return null;
    return displayName(data.user);
  };
}

/** entered_by ids → names. An id the lookup can't resolve is left out (its name reads null). */
export async function resolveEnteredNames(ids: Iterable<string | null | undefined>, lookup: NameLookup | null): Promise<EnteredNames> {
  const out = new Map<string, string>();
  if (!lookup) return out;
  const unique = [...new Set([...ids].filter((id): id is string => !!id))].sort();
  for (const id of unique) {
    try {
      const name = await lookup(id);
      if (name) out.set(id, name);
    } catch {
      // Not the service role, or the user is gone: the name stays unknown.
    }
  }
  return out;
}
