import { NextResponse, type NextRequest } from "next/server";

import { refreshDerivedFunnelPacingTargets } from "@/lib/reporting/funnel-pacing";

export const maxDuration = 300;

function isAuthorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = req.headers.get("authorization") ?? "";
  if (header.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim() === expected.trim();
  }
  return header.trim() === expected.trim();
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  const startedAt = new Date().toISOString();
  try {
    const result = await refreshDerivedFunnelPacingTargets();
    return NextResponse.json({
      ok: true,
      startedAt,
      finishedAt: new Date().toISOString(),
      ...result,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        startedAt,
        finishedAt: new Date().toISOString(),
        error: err instanceof Error ? err.message : "Unknown funnel pacing error",
      },
      { status: 500 },
    );
  }
}
