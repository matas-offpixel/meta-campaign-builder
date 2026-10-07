/** Stand-in for lib/supabase/{server,client}.ts under alias-hooks.mjs. */

type Stub = { db: unknown };

function current(): unknown {
  const stub = (globalThis as { __supabaseStub?: Stub }).__supabaseStub;
  if (!stub) throw new Error("supabase-stub: set globalThis.__supabaseStub = { db } first");
  return stub.db;
}

export function setSupabaseStub(db: unknown): void {
  (globalThis as { __supabaseStub?: Stub }).__supabaseStub = { db };
}

export function createClient(): never {
  return current() as never;
}

export function createServiceRoleClient(): never {
  return current() as never;
}
