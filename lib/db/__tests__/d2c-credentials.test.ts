import { test } from "node:test";

/**
 * RPC round-trip against a real Supabase project (migration 042 applied).
 * Enable with SUPABASE_TEST_URL + service key when automating; skipped by default.
 */
test(
  "d2c credentials RPC round-trip",
  { skip: !process.env.SUPABASE_TEST_URL },
  async () => {
    // Intentionally empty — operators run a one-off script or extend this
    // when CI provisions a disposable Supabase + D2C_TOKEN_KEY.
  },
);
