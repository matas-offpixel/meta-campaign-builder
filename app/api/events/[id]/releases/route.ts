import { NextResponse } from "next/server";

import { loadEventReleases, saveReleaseRow, insertWarning } from "@/lib/db/releases";
import { applyCount, applyState } from "@/lib/releases/entry";
import { deriveSaleDates } from "@/lib/releases/dates";
import { defaultLadder } from "@/lib/releases/ladder";
import type { ReleaseState, StateSource } from "@/lib/releases/types";
import { proposalOnChange, nextRung } from "@/lib/ticket-warnings/next-rung";
import { createClient } from "@/lib/supabase/server";

const STATES = new Set(["not_yet", "on_sale", "selling_fast", "final_x", "sold_out"]);
const SOURCES = new Set(["vendor_page", "client_message", "entry"]);

/**
 * POST /api/events/[id]/releases
 * Sets a release's state or its count, then derives presale_at and general_sale_at.
 * A backwards state asks once. A count writes tier_channel_sales only with a capacity.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const db = await createClient();
  const { data: auth } = await db.auth.getUser();
  const user = auth.user;
  if (!user) return NextResponse.json({ error: "Sign in again." }, { status: 401 });

  const body = (await request.json()) as {
    releaseId?: string;
    state?: string;
    confirmed?: boolean;
    sold?: number;
    source?: string;
  };
  const releases = await loadEventReleases(db, id);
  if (!releases) return NextResponse.json({ error: "Releases are not on this database yet." }, { status: 503 });
  const current = releases.find((release) => release.id === body.releaseId);
  if (!current) return NextResponse.json({ error: "That release is not on this event." }, { status: 404 });

  const remembered = releases.find((release) => release.stateSource)?.stateSource ?? "entry";
  const source = (SOURCES.has(body.source ?? "") ? body.source : remembered) as StateSource;
  let next = current;
  if (body.state) {
    if (!STATES.has(body.state)) return NextResponse.json({ error: "That is not a release state." }, { status: 400 });
    const applied = applyState(current, body.state as ReleaseState, {
      at: new Date().toISOString(),
      source,
      user: user.id,
      confirmed: body.confirmed === true,
    });
    if (applied.ask) return NextResponse.json({ ask: true });
    next = applied.release;
  }
  let tierSale: { tierName: string; ticketsSold: number } | null = null;
  if (typeof body.sold === "number") {
    const counted = applyCount(next, body.sold);
    next = counted.release;
    tierSale = counted.tierSale;
  }

  await saveReleaseRow(db, next);
  const saved = releases.map((release) => (release.id === next.id ? next : release));
  const dates = deriveSaleDates(saved);
  const { error: dateError } = await db.from("events").update({
    presale_at: dates.presaleAt,
    general_sale_at: dates.generalSaleAt,
  }).eq("id", id);
  if (dateError) return NextResponse.json({ error: dateError.message }, { status: 500 });

  if (tierSale) {
    const { data: event } = await db.from("events").select("client_id").eq("id", id).maybeSingle();
    if (event?.client_id) {
      const { data: channels } = await db.from("tier_channels").select("id, channel_name").eq("client_id", event.client_id);
      const manual = channels?.find((channel) => channel.channel_name === "manual");
      if (manual) {
        await db.from("tier_channel_sales").upsert(
          {
            event_id: id,
            tier_name: tierSale.tierName,
            channel_id: manual.id,
            tickets_sold: tierSale.ticketsSold,
            revenue_amount: 0,
          },
          { onConflict: "event_id,tier_name,channel_id" },
        );
      }
    }
  }

  const rung = nextRung(next, defaultLadder(), saved, new Date().toISOString());
  const proposal = proposalOnChange(null, rung);
  if (proposal.propose && proposal.claim) {
    await insertWarning(db, {
      userId: user.id,
      eventId: id,
      releaseId: next.id,
      claim: proposal.claim,
      format: "9:16",
      state: "held",
      trigger: { because: rung?.because ?? null, source },
      approvedAt: null,
      runsFrom: null,
      runsTo: null,
      why: null,
    });
  }

  return NextResponse.json({ ask: false, release: next, presaleAt: dates.presaleAt, generalSaleAt: dates.generalSaleAt });
}
