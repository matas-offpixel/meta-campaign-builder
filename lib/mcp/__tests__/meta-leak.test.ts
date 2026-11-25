/**
 * MW2: no raw error reaches Claude. Each failure kind (an HTTP status from
 * the upload handler, Meta's own message, video_status, a launch route
 * error with and without a campaign, a thrown network error, a database
 * error) is fed through every mcp:meta tool, and the answer Claude would get
 * (the server's own errorAnswer, or the tool's data) is checked:
 *   - it carries no HTTP status, Meta message, video_status or database text;
 *   - its message lines, and each failed-file line, are rows of design's
 *     list (the fixture), placeholders filled.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { errorAnswer } from "../server.ts";
import { launchDraftTool, uploadDraftAssetsTool } from "../tools/meta-launch.ts";
import { updateEventTool } from "../tools/meta-event.ts";
import type { McpTool, ToolContext } from "../tool-types.ts";
import { D_DRAFT } from "./draft-fixtures.ts";
import { LAUNCHED, YES, metaCtx } from "./meta-fixtures.ts";

const FIXTURE = new URL("./fixtures/words-mcp-today-2026-11-25.tsv", import.meta.url);
const ROWS = readFileSync(FIXTURE, "utf8")
  .split("\n")
  .slice(1)
  .filter(Boolean)
  .map((l) => l.split("\t")[2]!);
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const PATTERNS = ROWS.map((w) => new RegExp(`^${escape(w).replace(/\\\{[^}]+\\\}/g, "[\\s\\S]+?")}$`));
const isRow = (line: string) => PATTERNS.some((p) => p.test(line));

/** The raw texts the fakes put in play: none of them may reach Claude. */
const META_MESSAGE = "(#100) Invalid parameter fbtrace_id AbCdEf";
const DB_MESSAGE = "duplicate key value violates unique constraint events_pkey";
const NETWORK = "socket hang up ECONNRESET";
const RAW = /HTTP\s?\d|"status":\s?[45]\d\d|video_status|fbtrace|\(#\d+\)|violates|ECONNRESET|socket hang up|PGRST|relation |Could not find/i;

interface Answer {
  text: string;
  error: string | null;
  message: string | null;
  failed: string[];
}

async function answer(tool: McpTool, ctx: ToolContext, args: Record<string, unknown>): Promise<Answer> {
  let text: string;
  try {
    const out = await tool.run(ctx, args);
    text = JSON.stringify(out.data);
  } catch (e) {
    text = errorAnswer(tool, e);
  }
  const json = JSON.parse(text) as { error?: string; message?: string; failed?: unknown };
  return {
    text,
    error: json.error ?? null,
    message: json.message ?? null,
    failed: Array.isArray(json.failed) ? json.failed.filter((x): x is string => typeof x === "string") : [],
  };
}

function assertClean(a: Answer, label: string) {
  assert.doesNotMatch(a.text, RAW, `${label}: a raw error reached Claude: ${a.text.slice(0, 300)}`);
  for (const line of [...(a.error ?? "").split("\n"), ...(a.message ?? "").split("\n"), ...a.failed].filter(Boolean)) {
    assert.ok(isRow(line), `${label}: not a row of the list: ${line}`);
  }
}

/** A table whose every query answers a database error. */
function failing(ctx: ToolContext, table: string, message: string) {
  const db = ctx.db;
  const chain: Record<string, unknown> = {};
  const p = Promise.resolve({ data: null, error: { message } });
  for (const m of ["select", "eq", "neq", "in", "is", "not", "update", "insert", "upsert", "order", "range", "limit", "gte", "lte", "or"]) chain[m] = () => chain;
  chain.maybeSingle = () => p;
  chain.single = () => p;
  chain.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => p.then(res, rej);
  ctx.db = { from: (t: string) => (t === table ? chain : db.from(t)) } as never;
}

const launch = (mode: "paused" | "live") => ({ draft_id: D_DRAFT, mode, approval: YES });

test("upload failures: an HTTP status with Meta's message, through launch_draft and upload_draft_assets", async () => {
  for (const [tool, args] of [
    [launchDraftTool, launch("paused")],
    [uploadDraftAssetsTool, { draft_id: D_DRAFT, approval: YES }],
  ] as const) {
    const { ctx } = await metaCtx();
    const deps = ctx.meta!;
    ctx.meta = {
      ...deps,
      sendAssets: async (input) => {
        const out = await deps.sendAssets(input);
        // As the real handler fails: the slot keeps Meta's message and the HTTP status.
        return {
          ...out,
          failed: out.slots.map((s) => ({ ...s, error: `HTTP 500 ${META_MESSAGE}` })),
          results: out.results.map((r) => ({ ...r, uploadStatus: "error" as const, error: `HTTP 500 ${META_MESSAGE}` })),
          uploaded: 0,
        };
      },
    };
    const a = await answer(tool, ctx, args);
    assertClean(a, `${tool.name} upload`);
    assert.equal(a.failed.length, 2);
  }
});

test("video_status error, through launch_draft and upload_draft_assets", async () => {
  for (const [tool, args] of [
    [launchDraftTool, launch("paused")],
    [uploadDraftAssetsTool, { draft_id: D_DRAFT, approval: YES }],
  ] as const) {
    const { ctx, spy } = await metaCtx();
    spy.erroredVideos = ["vid-h-a"];
    const a = await answer(tool, ctx, args);
    assertClean(a, `${tool.name} video`);
    assert.deepEqual(a.failed, ["teaser-1_9x16.mp4: Meta couldn’t process the video."]);
  }
});

test("the launch route: an error with no campaign, an error after the campaign, ad sets that failed, a thrown network error", async () => {
  const cases: Array<[string, () => Promise<{ status: number; body: Record<string, unknown> }>]> = [
    ["no campaign", async () => ({ status: 500, body: { error: META_MESSAGE, source: "meta" } })],
    ["after the campaign", async () => ({ status: 502, body: { error: META_MESSAGE, metaCampaignId: "120200000000000001", adSetsCreated: [] } })],
    ["ad sets failed", async () => ({ status: 200, body: { ...LAUNCHED, adSetsCreated: LAUNCHED.adSetsCreated.slice(0, 1), adSetsFailed: [{ name: "Fans", error: META_MESSAGE }] } })],
    ["network", async () => {
      throw new Error(NETWORK);
    }],
  ];
  for (const mode of ["paused", "live"] as const) {
    for (const [label, launchFn] of cases) {
      const { ctx } = await metaCtx({ ceiling: 500 });
      ctx.meta = { ...ctx.meta!, launch: launchFn };
      const a = await answer(launchDraftTool, ctx, launch(mode));
      assertClean(a, `launch_draft ${mode} ${label}`);
      if (label !== "no campaign" && label !== "network") assert.match(a.error ?? "", /120200000000000001/);
    }
  }
});

test("thrown errors in the send step: launch_draft answers its failure row", async () => {
  const { ctx } = await metaCtx();
  ctx.meta = { ...ctx.meta!, sendAssets: async () => { throw new Error(`relation "creative_assets" does not exist ${DB_MESSAGE}`); } };
  assertClean(await answer(launchDraftTool, ctx, launch("paused")), "launch_draft send threw");
});

test("thrown errors in the send step: upload_draft_assets has no failure row yet (sent to design)", { todo: "claude.mcp.upload.failed has no form for a send step that threw before any file was tried" }, async () => {
  const { ctx } = await metaCtx();
  ctx.meta = { ...ctx.meta!, sendAssets: async () => { throw new Error(NETWORK); } };
  assertClean(await answer(uploadDraftAssetsTool, ctx, { draft_id: D_DRAFT, approval: YES }), "upload_draft_assets send threw");
});

test("database errors: the ceiling read (live launch) and update_event's read and save", async () => {
  {
    const { ctx } = await metaCtx({ ceiling: 500 });
    failing(ctx, "client_spend_ceilings", DB_MESSAGE);
    const a = await answer(launchDraftTool, ctx, launch("live"));
    assertClean(a, "launch_draft ceiling");
    assert.equal(a.error, "Refused: the client’s daily ceiling couldn’t be read. Try again. Nothing was sent to Meta.");
  }
  for (const table of ["events"]) {
    const { ctx } = await metaCtx();
    failing(ctx, table, DB_MESSAGE);
    const a = await answer(updateEventTool, ctx, { event_code: "NX27-GLITTERBOX", changes: { presale_at: "2027-01-15T10:00:00Z" }, approval: YES });
    assertClean(a, `update_event ${table}`);
  }
  {
    // The save alone fails: the read works, the update answers a database error.
    const { ctx } = await metaCtx();
    const db = ctx.db;
    ctx.db = {
      from: (t: string) => {
        const q = db.from(t) as unknown as Record<string, (...a: unknown[]) => unknown>;
        if (t !== "events") return q;
        return new Proxy(q, {
          get(target, prop) {
            if (prop === "update") return () => ({ eq: () => ({ eq: () => ({ select: async () => ({ data: null, error: { message: DB_MESSAGE } }) }) }) });
            return (target as Record<string | symbol, unknown>)[prop as string];
          },
        });
      },
    } as never;
    const a = await answer(updateEventTool, ctx, { event_code: "NX27-GLITTERBOX", changes: { presale_at: "2027-01-15T10:00:00Z" }, approval: YES });
    assertClean(a, "update_event save");
    assert.equal(a.error, "The event couldn’t be saved. Try again. Nothing changed.");
  }
});

test("refusals and successes are rows too: no approval, no ceiling, over it, checks, paused and live, the upload and the event edit", async () => {
  {
    const { ctx } = await metaCtx();
    assertClean(await answer(launchDraftTool, ctx, { draft_id: D_DRAFT, mode: "paused" }), "no approval");
  }
  {
    const { ctx } = await metaCtx({ ceiling: null });
    assertClean(await answer(launchDraftTool, ctx, launch("live")), "no ceiling");
  }
  {
    const { ctx } = await metaCtx({ ceiling: 10 });
    assertClean(await answer(launchDraftTool, ctx, launch("live")), "over ceiling");
  }
  {
    const { ctx } = await metaCtx({ storage: false });
    assertClean(await answer(launchDraftTool, ctx, launch("paused")), "checks");
  }
  for (const mode of ["paused", "live"] as const) {
    const { ctx } = await metaCtx({ ceiling: 500 });
    assertClean(await answer(launchDraftTool, ctx, launch(mode)), `launched ${mode}`);
  }
  {
    const { ctx } = await metaCtx();
    const a = await answer(uploadDraftAssetsTool, ctx, { draft_id: D_DRAFT, approval: YES });
    assertClean(a, "uploaded");
    assertClean(await answer(uploadDraftAssetsTool, ctx, { draft_id: D_DRAFT, approval: YES }), "nothing to send");
  }
  {
    const { ctx } = await metaCtx();
    assertClean(await answer(updateEventTool, ctx, { event_code: "NX27-GLITTERBOX", changes: { announcement_at: "2026-11-27T18:00:00Z" }, approval: YES }), "event done");
    assertClean(await answer(updateEventTool, ctx, { event_code: "NOPE-1", changes: { announcement_at: "2026-11-27T18:00:00Z" }, approval: YES }), "event unknown");
  }
});
