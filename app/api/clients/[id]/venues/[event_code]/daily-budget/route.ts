import { NextResponse, type NextRequest } from "next/server";

import { resolveShareByToken } from "@/lib/db/report-shares";
import {
  fetchVenueDailyBudget,
  type VenueDailyBudgetResult,
} from "@/lib/insights/meta";
import { resolveServerMetaToken } from "@/lib/meta/server-token";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

const CACHE_TTL_MS = 60 * 60 * 1000;

interface CacheEntry {
  value: VenueDailyBudgetResult;
  expiresAt: number;
  refreshing?: Promise<void>;
}

const dailyBudgetCache = new Map<string, CacheEntry>();

function cacheKey(clientId: string, eventCode: string): string {
  const dayBucket = new Date().toISOString().slice(0, 10);
  return `${clientId}:${eventCode}:${dayBucket}`;
}

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    v,
  );
}

async function authorizeRequest(args: {
  req: NextRequest;
  clientId: string;
  eventCode: string;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const { data } = await supabase
      .from("clients")
      .select("id")
      .eq("id", args.clientId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (data) return { ok: true as const, userId: user.id };
  }

  const token = args.req.nextUrl.searchParams.get("client_token");
  if (!token) {
    return { ok: false as const, status: 401, error: "Unauthorised" };
  }
  const admin = createServiceRoleClient();
  const resolved = await resolveShareByToken(token, admin);
  if (!resolved.ok) {
    return { ok: false as const, status: 403, error: "Invalid share token" };
  }
  const share = resolved.share;
  if (share.client_id !== args.clientId) {
    return { ok: false as const, status: 403, error: "Share client mismatch" };
  }
  if (share.scope === "venue" && share.event_code !== args.eventCode) {
    return { ok: false as const, status: 403, error: "Share venue mismatch" };
  }
  if (share.scope !== "client" && share.scope !== "venue") {
    return { ok: false as const, status: 403, error: "Invalid share scope" };
  }
  return { ok: true as const, userId: share.user_id };
}

async function loadFreshDailyBudget(args: {
  clientId: string;
  eventCode: string;
  userId: string;
}): Promise<VenueDailyBudgetResult> {
  const admin = createServiceRoleClient();
  const { data: client } = await admin
    .from("clients")
    .select("id, meta_ad_account_id")
    .eq("id", args.clientId)
    .maybeSingle();
  const adAccountId =
    (client as { meta_ad_account_id?: string | null } | null)
      ?.meta_ad_account_id ?? null;
  if (!adAccountId) {
    console.info("[venue-daily-budget] unavailable: no ad account", {
      clientId: args.clientId,
      eventCode: args.eventCode,
    });
    return emptyBudgetResult("No Meta ad account");
  }

  const { data: event } = await admin
    .from("events")
    .select("id")
    .eq("client_id", args.clientId)
    .eq("event_code", args.eventCode)
    .limit(1)
    .maybeSingle();
  if (!event) {
    console.info("[venue-daily-budget] unavailable: no matching venue", {
      clientId: args.clientId,
      eventCode: args.eventCode,
    });
    return emptyBudgetResult("No matching venue");
  }

  let metaToken: string;
  try {
    metaToken = (await resolveServerMetaToken(admin, args.userId)).token;
  } catch (err) {
    console.warn(
      "[venue-daily-budget] unavailable: token resolve failed",
      args.eventCode,
      err instanceof Error ? err.message : err,
    );
    return emptyBudgetResult("Meta token unavailable");
  }

  return fetchVenueDailyBudget({
    eventCode: args.eventCode,
    adAccountId,
    token: metaToken,
  });
}

function emptyBudgetResult(reasonLabel: string): VenueDailyBudgetResult {
  return {
    dailyBudget: null,
    label: "daily",
    reason: "fetch_error",
    reasonLabel,
  };
}

function refreshCache(args: {
  key: string;
  clientId: string;
  eventCode: string;
  userId: string;
}) {
  const current = dailyBudgetCache.get(args.key);
  if (current?.refreshing) return current.refreshing;

  const refreshing = loadFreshDailyBudget(args)
    .then((value) => {
      dailyBudgetCache.set(args.key, {
        value,
        expiresAt: Date.now() + CACHE_TTL_MS,
      });
    })
    .catch((err) => {
      console.warn(
        "[venue-daily-budget] refresh failed",
        args.eventCode,
        err instanceof Error ? err.message : err,
      );
      if (!dailyBudgetCache.has(args.key)) {
        dailyBudgetCache.set(args.key, {
          value: emptyBudgetResult("Meta daily budget refresh failed"),
          expiresAt: Date.now() + CACHE_TTL_MS,
        });
      }
    })
    .finally(() => {
      const next = dailyBudgetCache.get(args.key);
      if (next) dailyBudgetCache.set(args.key, { ...next, refreshing: undefined });
    });

  dailyBudgetCache.set(args.key, {
    value: current?.value ?? emptyBudgetResult("Loading daily budget"),
    expiresAt: current?.expiresAt ?? 0,
    refreshing,
  });
  return refreshing;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; event_code: string }> },
) {
  const p = await params;
  const clientId = p.id;
  const eventCode = decodeURIComponent(p.event_code).trim();
  if (!isUuid(clientId) || !eventCode) {
    return NextResponse.json(
      {
        dailyBudget: null,
        label: "daily",
        reason: "Invalid venue",
        error: "Invalid venue",
      },
      { status: 400 },
    );
  }

  const auth = await authorizeRequest({ req, clientId, eventCode });
  if (!auth.ok) {
    return NextResponse.json(
      {
        dailyBudget: null,
        label: "daily",
        reason: auth.error,
        error: auth.error,
      },
      { status: auth.status },
    );
  }

  const key = cacheKey(clientId, eventCode);
  const cached = dailyBudgetCache.get(key);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return NextResponse.json({ ...cached.value, cached: true });
  }

  if (cached) {
    void refreshCache({ key, clientId, eventCode, userId: auth.userId });
    return NextResponse.json({
      ...cached.value,
      cached: true,
      stale: true,
    });
  }

  await refreshCache({ key, clientId, eventCode, userId: auth.userId });
  const fresh = dailyBudgetCache.get(key);
  return NextResponse.json({
    ...(fresh?.value ?? emptyBudgetResult("Daily budget unavailable")),
    cached: false,
  });
}
