/**
 * The signup sync's Graph calls, with a token (META_ACCESS_TOKEN on the cron).
 *
 * Reads go through graphGetWithToken (one attempt). Writes use their own
 * fetch: lib/meta/client.ts's graphPostWithToken prints the request body on
 * an error, and a /users body is hashes. Here nothing is logged, a response's
 * `invalid_entry_samples` is never read, and an error is Meta's code plus a
 * hash-free message.
 *
 *   POST   /{act}/customaudiences  { name, subtype, customer_file_source, description }
 *   POST   /{audience}/users       payload={ schema, data }   (form-encoded)
 *   DELETE /{audience}/users       payload={ schema, data }
 *
 * `reads` / `writes` count every Graph attempt for the run's report.
 */

import { graphGetWithToken } from "../meta/client.ts";
import { redactHashes } from "./rules.ts";
import type { CustomerListGraph, MetaAudience, UsersResult } from "./sync.ts";

const API_VERSION = process.env.META_API_VERSION ?? "v21.0";
const BASE = `https://graph.facebook.com/${API_VERSION}`;
const LIST_FIELDS = "id,name,subtype,account_id";

export class CustomerListGraphError extends Error {
  readonly code: number | null;
  constructor(code: number | null, message: string) {
    super(redactHashes(message));
    this.name = "CustomerListGraphError";
    this.code = code;
  }
}

type Paged<T> = { data?: T[]; paging?: { cursors?: { after?: string }; next?: string } };

function toAudience(r: Record<string, unknown>): MetaAudience {
  return {
    id: String(r.id),
    name: String(r.name ?? ""),
    subtype: typeof r.subtype === "string" ? r.subtype : null,
    account_id: r.account_id == null ? null : String(r.account_id),
  };
}

async function write(method: "POST" | "DELETE", path: string, form: Record<string, string>, token: string): Promise<Record<string, unknown>> {
  const body = new URLSearchParams({ ...form, access_token: token });
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      cache: "no-store",
    });
  } catch (err) {
    throw new CustomerListGraphError(null, `network error calling Meta (${err instanceof Error ? err.name : "error"})`);
  }
  let json: Record<string, unknown> = {};
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    // An empty or non-JSON body: judged on the status below.
  }
  const e = json.error as { code?: unknown; message?: unknown; error_subcode?: unknown } | undefined;
  if (!res.ok || e) {
    const code = typeof e?.code === "number" ? e.code : null;
    const sub = typeof e?.error_subcode === "number" ? ` subcode=${e.error_subcode}` : "";
    throw new CustomerListGraphError(code, `${typeof e?.message === "string" ? e.message : `HTTP ${res.status}`}${sub}`);
  }
  return json;
}

function usersResult(json: Record<string, unknown>, sent: number): UsersResult {
  const received = Number(json.num_received);
  const invalid = Number(json.num_invalid_entries);
  return { received: Number.isFinite(received) ? received : sent, invalid: Number.isFinite(invalid) ? invalid : 0 };
}

export function liveCustomerListGraph(token: string): CustomerListGraph & { reads(): number; writes(): number } {
  let reads = 0;
  let writes = 0;
  return {
    reads: () => reads,
    writes: () => writes,
    async listAudiences(account) {
      const out: MetaAudience[] = [];
      let after: string | undefined;
      for (let page = 0; page < 50; page += 1) {
        reads += 1;
        const params: Record<string, string> = { fields: LIST_FIELDS, limit: "500" };
        if (after) params.after = after;
        const res = await graphGetWithToken<Paged<Record<string, unknown>>>(`/${account}/customaudiences`, params, token, { maxAttempts: 1 });
        out.push(...(res.data ?? []).map(toAudience));
        after = res.paging?.cursors?.after;
        if (!res.paging?.next || !after) break;
      }
      return out;
    },
    async getAudience(id) {
      reads += 1;
      try {
        return toAudience(await graphGetWithToken<Record<string, unknown>>(`/${id}`, { fields: LIST_FIELDS }, token, { maxAttempts: 1 }));
      } catch (err) {
        const code = (err as { code?: unknown }).code;
        // 100 / 803: no such object, or not visible to this token.
        if (code === 100 || code === 803) return null;
        throw err;
      }
    },
    async createList(account, body) {
      writes += 1;
      const form: Record<string, string> = {};
      for (const [k, v] of Object.entries(body)) form[k] = String(v);
      const json = await write("POST", `/${account}/customaudiences`, form, token);
      if (typeof json.id !== "string" || !/^\d+$/.test(json.id)) throw new CustomerListGraphError(null, "create returned no audience id");
      return json.id;
    },
    async addUsers(audienceId, payload) {
      writes += 1;
      return usersResult(await write("POST", `/${audienceId}/users`, { payload: JSON.stringify(payload) }, token), payload.data.length);
    },
    async removeUsers(audienceId, payload) {
      writes += 1;
      return usersResult(await write("DELETE", `/${audienceId}/users`, { payload: JSON.stringify(payload) }, token), payload.data.length);
    },
  };
}

/** The same graph with every write refused: the dry run's guard (GETs only). */
export function readOnlyGraph(graph: CustomerListGraph): CustomerListGraph {
  const refuse = async (): Promise<never> => {
    throw new Error("dry run: Meta writes are refused");
  };
  return { listAudiences: (a) => graph.listAudiences(a), getAudience: (id) => graph.getAudience(id), createList: refuse, addUsers: refuse, removeUsers: refuse };
}
