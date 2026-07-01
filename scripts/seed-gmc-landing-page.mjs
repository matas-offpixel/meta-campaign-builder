// scripts/seed-gmc-landing-page.mjs
//
// One-shot seed for the GMC Worldwide Productions landing-page trial
// (landing-page arc PR 1, migration 132). Idempotent — clients/events are
// looked up, landing-page rows are upserted on their unique keys, re-runs
// are no-ops.
//
// What it does:
//   1. Looks up the GMC client by slug (gmc-worldwide-productions).
//   2. Upserts client_landing_pages for GMC:
//        default_provider='internal', theme={}, meta_pixel_id=null
//        (GMC's real Pixel ID is pasted in via the Supabase dashboard
//        before PR 3 wires the script — this PR stores config only).
//   3. Looks up the 2026 Jackies Mallorca event. Verified against prod on
//      2026-07-01: id 160fbb1c-a4be-4435-a53d-a690c9edf895, event_date
//      2026-08-16. NOTE a 2025 event exists with the SAME name
//      (ec1a2f22-…, event_date 2025-08-16) — the lookup pins name + date
//      and falls back to the known id, never to name alone.
//   4. Upserts page_events for that event:
//        provider='internal', status='draft', content populated from the
//        event row + template_key='mvp_v1'.
//
// Run modes (DRY_RUN=1 is the DEFAULT — pass DRY_RUN=0 to actually write):
//
//   # Preview only (no writes):
//   set -a && source .env.local && set +a && \
//     node scripts/seed-gmc-landing-page.mjs
//
//   # Live upsert:
//   set -a && source .env.local && set +a && \
//     DRY_RUN=0 node scripts/seed-gmc-landing-page.mjs
//
// Success gate (manual, pre-merge): npm run dev, then open
//   /l/gmc-worldwide-productions/{event-slug printed below}
// → placeholder renders client name + event name + 'mvp_v1' from the DB.

import { createClient } from "@supabase/supabase-js";

// ─── Env wiring ──────────────────────────────────────────────────────────
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DRY_RUN = process.env.DRY_RUN !== "0"; // default ON

if (!supabaseUrl || !serviceRoleKey) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — " +
      "source .env.local first.",
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ─── Constants (verified against prod 2026-07-01) ────────────────────────
const GMC_CLIENT_SLUG = "gmc-worldwide-productions";
const MALLORCA_2026_EVENT_ID = "160fbb1c-a4be-4435-a53d-a690c9edf895";
const MALLORCA_2026_DATE = "2026-08-16";
const TEMPLATE_KEY = "mvp_v1";

async function main() {
  console.log(`DRY_RUN=${DRY_RUN ? "1 (preview only)" : "0 (LIVE)"}`);

  // 1. GMC client.
  const { data: clients, error: clientErr } = await supabase
    .from("clients")
    .select("id, user_id, name, slug")
    .eq("slug", GMC_CLIENT_SLUG);
  if (clientErr) throw new Error(`clients lookup: ${clientErr.message}`);
  if (!clients || clients.length !== 1) {
    throw new Error(
      `expected exactly 1 client with slug ${GMC_CLIENT_SLUG}, ` +
        `found ${clients?.length ?? 0} — refusing to guess.`,
    );
  }
  const gmc = clients[0];
  console.log(`client: ${gmc.name} (${gmc.id})`);

  // 2. The 2026 Mallorca event — pinned by id first, then name+date. Never
  //    name alone (a 2025 twin with the identical name exists).
  let event = null;
  {
    const { data, error } = await supabase
      .from("events")
      .select("id, name, slug, event_date, venue_name, venue_city, ticket_url, client_id")
      .eq("id", MALLORCA_2026_EVENT_ID)
      .eq("client_id", gmc.id);
    if (error) throw new Error(`events lookup by id: ${error.message}`);
    event = data?.[0] ?? null;
  }
  if (!event) {
    console.warn(
      `known event id ${MALLORCA_2026_EVENT_ID} not found — falling back to name+date match`,
    );
    const { data, error } = await supabase
      .from("events")
      .select("id, name, slug, event_date, venue_name, venue_city, ticket_url, client_id")
      .eq("client_id", gmc.id)
      .eq("event_date", MALLORCA_2026_DATE)
      .ilike("name", "%mallorca%");
    if (error) throw new Error(`events fallback lookup: ${error.message}`);
    if (!data || data.length !== 1) {
      throw new Error(
        `expected exactly 1 GMC event on ${MALLORCA_2026_DATE} matching ` +
          `"mallorca", found ${data?.length ?? 0} — refusing to guess.`,
      );
    }
    event = data[0];
  }
  console.log(`event: ${event.name} (${event.id})`);
  console.log(`event slug: ${event.slug}`);

  // 3. client_landing_pages upsert (unique on client_id).
  const landingPageRow = {
    client_id: gmc.id,
    theme: {},
    meta_pixel_id: null, // pasted in via Supabase dashboard before PR 3
    default_provider: "internal",
    created_by: gmc.user_id,
  };

  // 4. page_events upsert (unique on event_id).
  const pageEventRow = {
    event_id: event.id,
    provider: "internal",
    evntree_url: null,
    theme_overrides: {},
    status: "draft",
    content: {
      template_key: TEMPLATE_KEY,
      headline: event.name,
      venue_name: event.venue_name,
      venue_city: event.venue_city,
      event_date: event.event_date,
      ticket_url: event.ticket_url,
    },
  };

  if (DRY_RUN) {
    console.log("\n[DRY RUN] would upsert client_landing_pages:");
    console.log(JSON.stringify(landingPageRow, null, 2));
    console.log("\n[DRY RUN] would upsert page_events:");
    console.log(JSON.stringify(pageEventRow, null, 2));
  } else {
    const { error: lpErr } = await supabase
      .from("client_landing_pages")
      .upsert(landingPageRow, { onConflict: "client_id" });
    if (lpErr) throw new Error(`client_landing_pages upsert: ${lpErr.message}`);
    console.log("client_landing_pages upserted.");

    const { error: peErr } = await supabase
      .from("page_events")
      .upsert(pageEventRow, { onConflict: "event_id" });
    if (peErr) throw new Error(`page_events upsert: ${peErr.message}`);
    console.log("page_events upserted.");
  }

  console.log(
    `\nVerify: npm run dev → http://localhost:3000/l/${gmc.slug}/${event.slug}`,
  );
  console.log(
    "Expect: placeholder with client name + event name + template 'mvp_v1'.",
  );
}

main().catch((e) => {
  console.error("FATAL:", e instanceof Error ? e.message : e);
  process.exit(1);
});
