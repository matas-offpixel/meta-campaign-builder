/**
 * lib/mcp/oauth/store.ts
 *
 * The OAuth store behind the MCP server: migration 268's mcp_oauth_* tables
 * (service role), or an in-memory store for local dev and tests.
 *
 * Only SHA-256 hashes of codes and tokens are ever handed to a store.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface OAuthClientRow {
  client_id: string;
  client_name: string | null;
  redirect_uris: string[];
  created_at: string;
}

export interface GrantRow {
  id: string;
  user_id: string;
  client_id: string;
  scope: string;
  resource: string;
  created_at: string;
  revoked_at: string | null;
}

export interface CodeRow {
  code_hash: string;
  client_id: string;
  user_id: string;
  scope: string;
  resource: string;
  redirect_uri: string;
  code_challenge: string;
  expires_at: string;
  used_at: string | null;
}

export interface TokenRow {
  token_hash: string;
  grant_id: string;
  kind: "access" | "refresh";
  expires_at: string;
  revoked_at: string | null;
  replaced_by: string | null;
}

export type RevokeReason = "user" | "refresh_reuse" | "operator_removed" | "script" | "revocation_endpoint";

export interface McpStore {
  readonly kind: "supabase" | "memory";
  insertClient(row: Omit<OAuthClientRow, "created_at">): Promise<OAuthClientRow>;
  getClient(clientId: string): Promise<OAuthClientRow | null>;
  insertCode(row: Omit<CodeRow, "used_at">): Promise<void>;
  /** Marks the code used and returns it, only if it was unused (one atomic update). */
  consumeCode(codeHash: string, nowIso: string): Promise<CodeRow | null>;
  insertGrant(row: Pick<GrantRow, "user_id" | "client_id" | "scope" | "resource">): Promise<GrantRow>;
  getGrant(grantId: string): Promise<GrantRow | null>;
  revokeGrant(grantId: string, reason: RevokeReason, nowIso: string): Promise<void>;
  listLiveGrants(filter: { userId?: string }): Promise<GrantRow[]>;
  insertTokens(rows: Array<Omit<TokenRow, "revoked_at" | "replaced_by">>): Promise<void>;
  getToken(tokenHash: string): Promise<TokenRow | null>;
  /** Sets replaced_by on an unreplaced refresh token; true only for the call that wins. */
  markRefreshReplaced(tokenHash: string, newHash: string): Promise<boolean>;
  touchGrant(grantId: string, nowIso: string): Promise<void>;
}

// ── In-memory (local dev + tests) ────────────────────────────────────────────

interface MemoryState {
  clients: Map<string, OAuthClientRow>;
  grants: Map<string, GrantRow>;
  codes: Map<string, CodeRow>;
  tokens: Map<string, TokenRow>;
}

function freshState(): MemoryState {
  return { clients: new Map(), grants: new Map(), codes: new Map(), tokens: new Map() };
}

export function createMemoryStore(state: MemoryState = freshState()): McpStore {
  const now = () => new Date().toISOString();
  return {
    kind: "memory",
    async insertClient(row) {
      const full = { ...row, created_at: now() };
      state.clients.set(row.client_id, full);
      return full;
    },
    async getClient(id) {
      return state.clients.get(id) ?? null;
    },
    async insertCode(row) {
      state.codes.set(row.code_hash, { ...row, used_at: null });
    },
    async consumeCode(hash, nowIso) {
      const row = state.codes.get(hash);
      if (!row || row.used_at) return null;
      row.used_at = nowIso;
      return { ...row };
    },
    async insertGrant(row) {
      const g: GrantRow = { ...row, id: crypto.randomUUID(), created_at: now(), revoked_at: null };
      state.grants.set(g.id, g);
      return { ...g };
    },
    async getGrant(id) {
      const g = state.grants.get(id);
      return g ? { ...g } : null;
    },
    async revokeGrant(id, _reason, nowIso) {
      const g = state.grants.get(id);
      if (g && !g.revoked_at) g.revoked_at = nowIso;
    },
    async listLiveGrants({ userId }) {
      return [...state.grants.values()].filter((g) => !g.revoked_at && (!userId || g.user_id === userId));
    },
    async insertTokens(rows) {
      for (const r of rows) state.tokens.set(r.token_hash, { ...r, revoked_at: null, replaced_by: null });
    },
    async getToken(hash) {
      const t = state.tokens.get(hash);
      return t ? { ...t } : null;
    },
    async markRefreshReplaced(hash, newHash) {
      const t = state.tokens.get(hash);
      if (!t || t.replaced_by) return false;
      t.replaced_by = newHash;
      return true;
    },
    async touchGrant() {},
  };
}

/**
 * The dev store lives on globalThis so every route bundle in one `next dev`
 * process shares it. Refused on Vercel: a deployment must use the tables.
 */
export function devMemoryStore(env: Record<string, string | undefined> = process.env): McpStore {
  if (env.VERCEL_ENV || env.VERCEL) throw new Error("MCP_DEV_TOKEN_STORE=memory is local-only.");
  const g = globalThis as unknown as { __opxMcpDevStore?: MemoryState };
  g.__opxMcpDevStore ??= freshState();
  return createMemoryStore(g.__opxMcpDevStore);
}

// ── Supabase (migration 268, service role) ───────────────────────────────────

type Db = Pick<SupabaseClient, "from">;

function check<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`mcp store ${what}: ${res.error.message}`);
  return res.data;
}

export function createSupabaseStore(db: Db): McpStore {
  return {
    kind: "supabase",
    async insertClient(row) {
      const res = await db.from("mcp_oauth_clients").insert(row).select("client_id, client_name, redirect_uris, created_at").single();
      return check(res, "insert client") as OAuthClientRow;
    },
    async getClient(id) {
      const res = await db.from("mcp_oauth_clients").select("client_id, client_name, redirect_uris, created_at").eq("client_id", id).maybeSingle();
      return (check(res, "get client") as OAuthClientRow | null) ?? null;
    },
    async insertCode(row) {
      check(await db.from("mcp_oauth_codes").insert(row), "insert code");
    },
    async consumeCode(hash, nowIso) {
      const res = await db
        .from("mcp_oauth_codes")
        .update({ used_at: nowIso })
        .eq("code_hash", hash)
        .is("used_at", null)
        .select("code_hash, client_id, user_id, scope, resource, redirect_uri, code_challenge, expires_at, used_at")
        .maybeSingle();
      return (check(res, "consume code") as CodeRow | null) ?? null;
    },
    async insertGrant(row) {
      const res = await db.from("mcp_oauth_grants").insert(row).select("id, user_id, client_id, scope, resource, created_at, revoked_at").single();
      return check(res, "insert grant") as GrantRow;
    },
    async getGrant(id) {
      const res = await db.from("mcp_oauth_grants").select("id, user_id, client_id, scope, resource, created_at, revoked_at").eq("id", id).maybeSingle();
      return (check(res, "get grant") as GrantRow | null) ?? null;
    },
    async revokeGrant(id, reason, nowIso) {
      check(
        await db.from("mcp_oauth_grants").update({ revoked_at: nowIso, revoked_reason: reason }).eq("id", id).is("revoked_at", null),
        "revoke grant",
      );
      check(await db.from("mcp_oauth_tokens").update({ revoked_at: nowIso }).eq("grant_id", id).is("revoked_at", null), "revoke tokens");
    },
    async listLiveGrants({ userId }) {
      let q = db.from("mcp_oauth_grants").select("id, user_id, client_id, scope, resource, created_at, revoked_at").is("revoked_at", null);
      if (userId) q = q.eq("user_id", userId);
      const res = await q.order("created_at", { ascending: true }).range(0, 999);
      return (check(res, "list grants") as GrantRow[]) ?? [];
    },
    async insertTokens(rows) {
      check(await db.from("mcp_oauth_tokens").insert(rows), "insert tokens");
    },
    async getToken(hash) {
      const res = await db
        .from("mcp_oauth_tokens")
        .select("token_hash, grant_id, kind, expires_at, revoked_at, replaced_by")
        .eq("token_hash", hash)
        .maybeSingle();
      return (check(res, "get token") as TokenRow | null) ?? null;
    },
    async markRefreshReplaced(hash, newHash) {
      const res = await db
        .from("mcp_oauth_tokens")
        .update({ replaced_by: newHash })
        .eq("token_hash", hash)
        .eq("kind", "refresh")
        .is("replaced_by", null)
        .select("token_hash")
        .maybeSingle();
      return Boolean(check(res, "rotate refresh"));
    },
    async touchGrant(id, nowIso) {
      await db.from("mcp_oauth_grants").update({ last_used_at: nowIso }).eq("id", id);
    },
  };
}
