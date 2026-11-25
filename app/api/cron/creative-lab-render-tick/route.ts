/**
 * GET /api/cron/creative-lab-render-tick
 *
 * Every minute. Claims queued Creative Lab caption renders, up to
 * MAX_LAB_RENDERS_AT_ONCE in flight (lib/creative-lab/lambda.ts), and
 * burns them side by side. No Meta calls. Auth is the cron bearer.
 *
 * A cron_runs row is written only when the tick claimed a render, timed
 * one out, failed one on its clip's face check, or failed. /admin/cron-health does not treat a missing minute
 * as a failure: it watches snapshot-table freshness and CRON_ALARMS, and
 * this cron is in neither. A quiet minute is not a heartbeat.
 */

import { NextResponse, type NextRequest } from "next/server";

import { isCronAuthorized } from "@/lib/attribution/cron-auth";
import { loadArchivedClientScope } from "@/lib/db/client-status";
import { isRemotionEnabled } from "@/lib/creatives/types";
import { runRenderTick } from "@/lib/creative-lab/render-queue";
import { withCronRunLog } from "@/lib/reporting/with-cron-run-log";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const maxDuration = 800;

async function snippetTick(supabase: ReturnType<typeof createServiceRoleClient>, archived: ReadonlySet<string>) {
  const { driveFromEnv } = await import("@/lib/drive/client");
  const { drive, reason } = driveFromEnv();
  if (!drive) return { skippedReason: reason ?? "no_drive" };
  const { runSnippetRenderTick } = await import("@/lib/creative-tests/snippet-render");
  const { renderDeps } = await import("@/lib/creative-tests/snippet-render-server");
  try {
    return await runSnippetRenderTick(supabase, renderDeps(supabase, drive), { archivedEventIds: archived });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Before migration 255 is applied the table isn't there: a quiet skip, not a failed tick.
    if (/creative_lab_snippet_renders|does not exist|schema cache/i.test(message)) return { skippedReason: "table_missing" };
    throw err;
  }
}
/** M4a: render packages' files, after the caption renders, in the same Lambda budget (lib/render-templates/worker.ts). */
async function packageTick(supabase: ReturnType<typeof createServiceRoleClient>) {
  const { driveFromEnv } = await import("@/lib/drive/client");
  const { drive } = driveFromEnv();
  const { runPackageTick } = await import("@/lib/render-templates/worker");
  const { workerDeps } = await import("@/lib/render-templates/server-deps");
  const { MAX_LAB_RENDERS_AT_ONCE } = await import("@/lib/creative-lab/lambda");
  try {
    return await runPackageTick(supabase, workerDeps(supabase, drive), { maxAtOnce: MAX_LAB_RENDERS_AT_ONCE });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Before migration 270 is applied the columns aren't there: a quiet skip, not a failed tick.
    if (/creative_lab_render_packages|recipe|does not exist|schema cache/i.test(message)) return { skippedReason: "table_missing" };
    throw err;
  }
}
export const dynamic = "force-dynamic";

async function handleGET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  let supabase: ReturnType<typeof createServiceRoleClient>;
  try {
    supabase = createServiceRoleClient();
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "Service-role client unavailable" }, { status: 500 });
  }
  try {
    const scope = await loadArchivedClientScope(supabase);
    const result = await runRenderTick(supabase, { archivedEventIds: scope.eventIds, remotionEnabled: isRemotionEnabled() });
    // CT1 / CT10: the audio snippet statics, after the caption renders. Their own in-flight cap.
    const snippets = isRemotionEnabled() ? await snippetTick(supabase, scope.eventIds) : null;
    const packages = isRemotionEnabled() ? await packageTick(supabase) : null;
    return NextResponse.json({ ...result, snippets, packages });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[creative-lab-render-tick] ${message}`);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export const GET = withCronRunLog(
  {
    cronName: "creative-lab-render-tick",
    getDb: () => {
      try {
        return createServiceRoleClient();
      } catch {
        return null;
      }
    },
    rows: (body) =>
      Number(body.claimed ?? 0) + Number((body.snippets as { claimed?: number } | null)?.claimed ?? 0) + Number((body.packages as { claimed?: number } | null)?.claimed ?? 0),
    detail: (body) => ({
      timedOut: body.timedOut ?? 0,
      faceCheckFailed: body.faceCheckFailed ?? 0,
      busy: body.busy ?? false,
      skippedArchived: body.skippedArchived ?? 0,
      snippets: body.snippets ?? null,
      packages: body.packages ?? null,
    }),
    recordWhen: (body, status) => {
      if (status >= 400 || body.ok === false) return true;
      const snippets = (body.snippets ?? null) as { claimed?: number; timedOut?: number } | null;
      return Number(body.claimed ?? 0) > 0
        || Number(body.timedOut ?? 0) > 0
        || Number(body.faceCheckFailed ?? 0) > 0
        || Number(snippets?.claimed ?? 0) > 0
        || Number(snippets?.timedOut ?? 0) > 0
        || Number((body.packages as { claimed?: number; settled?: number } | null)?.claimed ?? 0) > 0
        || Number((body.packages as { claimed?: number; settled?: number } | null)?.settled ?? 0) > 0;
    },
  },
  handleGET,
);
