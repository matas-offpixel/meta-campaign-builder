/**
 * lib/auth/client-context.ts
 *
 * Pure membership-resolution core for the client admin dashboard (OP909).
 * DI over a minimal structural Supabase slice — no supabase import, no
 * "@/" aliases — so node:test (react-server condition) can exercise the
 * real chain against an in-memory fake, mirroring
 * lib/landing-pages/context.ts. Production entrypoint:
 * requireClientContext in lib/auth/get-client-context.ts.
 *
 * Authorisation model: client_users (migration 137) maps one auth user to
 * exactly ONE client. The proxy AND every /admin server surface resolve
 * membership through this module — slug mismatch is always a hard throw,
 * never a silent fallback to another tenant.
 */

export interface ClientMembership {
  userId: string;
  clientId: string;
  clientSlug: string;
  clientName: string;
  role: string;
}

/** Minimal structural slice of the Supabase query builder used here. */
export interface MembershipDb {
  from(table: string): {
    select(columns: string): {
      eq(
        column: string,
        value: unknown,
      ): PromiseLike<{
        data: unknown[] | null;
        error: { message: string } | null;
      }>;
    };
  };
}

/** Thrown when an authed user tries a client scope they don't belong to. */
export class ClientScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClientScopeError";
  }
}

interface MembershipRow {
  client_id: string;
  role: string;
  clients: { name: string; slug: string } | Array<{ name: string; slug: string }> | null;
}

/**
 * Resolve the (single) client membership for an auth user, or null when
 * the user has no client_users row (e.g. an Off/Pixel operator). Throws on
 * query errors — a DB failure must never be confused with "no membership".
 */
export async function resolveClientMembership(
  db: MembershipDb,
  userId: string,
): Promise<ClientMembership | null> {
  const { data, error } = await db
    .from("client_users")
    .select("client_id, role, clients (name, slug)")
    .eq("user_id", userId);
  if (error) {
    throw new Error(
      `[client-context] client_users lookup failed: ${error.message}`,
    );
  }
  const rows = (data ?? []) as MembershipRow[];
  if (rows.length === 0) return null;
  // user_id is UNIQUE (migration 137) — more than one row means the DB
  // invariant broke; refuse to guess a tenant.
  if (rows.length > 1) {
    throw new Error(
      `[client-context] user ${userId} has ${rows.length} client_users rows — ` +
        `expected exactly one (user_id is UNIQUE). Refusing to guess a tenant.`,
    );
  }
  const row = rows[0];
  // The clients embed can be an object (many-to-one) or a 1-element array
  // depending on PostgREST FK inference — normalise both.
  const client = Array.isArray(row.clients) ? row.clients[0] : row.clients;
  if (!client || typeof client.slug !== "string" || client.slug.length === 0) {
    // RLS hid the clients row or the FK is dangling — either way the
    // membership is unusable; treat as a hard error, not "no membership".
    throw new Error(
      `[client-context] client_users row for user ${userId} resolved no ` +
        `readable clients row (client_id ${row.client_id}).`,
    );
  }
  return {
    userId,
    clientId: row.client_id,
    clientSlug: client.slug,
    clientName: client.name ?? client.slug,
    role: row.role,
  };
}

/**
 * Assert a resolved membership matches the URL's client slug. Throws
 * ClientScopeError on mismatch — callers map it to a 403, NEVER a redirect
 * into the other tenant's dashboard.
 */
export function assertClientSlugMatch(
  membership: ClientMembership,
  urlSlug: string,
): void {
  if (membership.clientSlug !== urlSlug) {
    throw new ClientScopeError(
      `authed as client "${membership.clientSlug}" but requested ` +
        `"${urlSlug}" — cross-tenant access denied`,
    );
  }
}
