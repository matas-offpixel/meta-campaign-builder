/**
 * The Top tracks analysis host's app-side client on fakes: the flag (off by
 * default: no signing, no AWS call), the request checks and TK18's key, the
 * reply checks, every failure kind (handled, Lambda's own timeout, our
 * abort, the concurrency cap, not deployed), the client's one-attempt
 * config, and "once per file version" over the migration 262 columns.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CLIENT_TIMEOUT_MS,
  FUNCTION_RESERVED_CONCURRENCY,
  FUNCTION_TIMEOUT_SECONDS,
  MAX_AUDIO_SECONDS,
  RUNNING_STALE_MS,
  TopTracksAnalysisError,
  analyseOnce,
  decideAnalysis,
  invokeTopTracksAnalysis,
  lambdaClientConfig,
  lambdaStudio,
  queuedAnalysisColumns,
  runAnalysisTick,
  supabaseAnalysisStore,
  validateAnalysisRequest,
  type LambdaInvoke,
  type StudioAnalysisShape,
} from "../top-tracks/lambda-analysis.ts";

const ON = { ENABLE_TOP_TRACKS_ANALYSIS: "1" };
const DRIVE_ID = "1KC9p6knOFV-r23xur8QgE-U6MMe3hnys";
const KEY = `${DRIVE_ID}@2026-11-18T10:00:00.000Z`;
const PATH = `audio/creative-lab/ev-1/${DRIVE_ID}.mp3`;
const SIGNED = "https://abcdefghijkl.supabase.co/storage/v1/object/sign/campaign-assets/x?token=t";
const ANALYSIS: StudioAnalysisShape = { durationS: 175.2, beats: [0.5, 1.0, 1.5], downbeats: [0.5], bassBeatDb: [-14.1, -14.2, -60] };

function reply(body: unknown, functionError?: string) {
  return { statusCode: 200, functionError, payload: JSON.stringify(body) };
}
const ok = (key = KEY) => reply({ ok: true, key, analysis: { model: { beats: "beat_this final0", stems: "htdemucs" }, ...ANALYSIS }, timingsS: { totalS: 120 } });

function fakeInvoke(answer: (call: Parameters<LambdaInvoke>[0]) => ReturnType<LambdaInvoke>) {
  const calls: Parameters<LambdaInvoke>[0][] = [];
  const invoke: LambdaInvoke = (call) => {
    calls.push(call);
    return answer(call);
  };
  return { invoke, calls };
}

const sign = async (p: string) => {
  assert.equal(p, PATH);
  return SIGNED;
};

async function rejectsKind(p: Promise<unknown>, kind: string) {
  await assert.rejects(p, (err: unknown) => err instanceof TopTracksAnalysisError && err.kind === kind);
}

describe("the flag", () => {
  it("is off by default: no signing, no AWS call", async () => {
    let signed = 0;
    const { invoke, calls } = fakeInvoke(async () => ok());
    for (const env of [{}, { ENABLE_TOP_TRACKS_ANALYSIS: "true" }, { ENABLE_TOP_TRACKS_ANALYSIS: "0" }]) {
      await rejectsKind(invokeTopTracksAnalysis({ key: KEY, storagePath: PATH }, { env, invoke, sign: async () => (signed++, SIGNED) }), "disabled");
    }
    assert.equal(signed, 0);
    assert.equal(calls.length, 0);
  });

  it("the tick skips with the flag off", async () => {
    const store = supabaseAnalysisStore(fakeDb([row({ ...queuedAnalysisColumns(KEY) })]).db);
    const out = await runAnalysisTick({ store, client: { env: {}, invoke: async () => ok() } });
    assert.deepEqual(out, { considered: 0, outcomes: [], skippedReason: "disabled" });
  });
});

describe("request checks and TK18's key", () => {
  it("accepts the Lab's Storage copy named by the key's Drive id, or a signed https URL", () => {
    assert.equal(validateAnalysisRequest({ key: KEY, storagePath: PATH }).driveFileId, DRIVE_ID);
    assert.deepEqual(validateAnalysisRequest({ key: KEY, audioUrl: SIGNED }).source, { audioUrl: SIGNED });
    assert.equal(validateAnalysisRequest({ key: `${DRIVE_ID}@unknown`, storagePath: PATH }).key, `${DRIVE_ID}@unknown`);
  });

  it("refuses a malformed key", () => {
    for (const key of ["", "no-at-sign", "short@2026", `${DRIVE_ID}@`, `${DRIVE_ID} @2026`, `${DRIVE_ID}@2026 11`, null as never]) {
      assert.throws(() => validateAnalysisRequest({ key, storagePath: PATH }), (e: unknown) => e instanceof TopTracksAnalysisError && e.kind === "bad_request", String(key));
    }
  });

  it("refuses both sources, neither, a path outside the Lab's copies, and a URL that isn't plain https", () => {
    const bad = [
      { key: KEY },
      { key: KEY, storagePath: PATH, audioUrl: SIGNED },
      { key: KEY, storagePath: `statics/${DRIVE_ID}.mp3` },
      { key: KEY, storagePath: `audio/creative-lab/../secrets/${DRIVE_ID}.mp3` },
      { key: KEY, storagePath: `/audio/creative-lab/ev-1/${DRIVE_ID}.mp3` },
      { key: KEY, audioUrl: "http://abcdefghijkl.supabase.co/x" },
      { key: KEY, audioUrl: "https://u:p@abcdefghijkl.supabase.co/x" },
      { key: KEY, audioUrl: "not a url" },
    ];
    for (const req of bad) assert.throws(() => validateAnalysisRequest(req), TopTracksAnalysisError, JSON.stringify(req));
  });

  it("refuses a key whose Drive id isn't the stored file's (one file version, one key)", () => {
    assert.throws(() => validateAnalysisRequest({ key: `OtherDriveFileId123@2026-11-18T10:00:00.000Z`, storagePath: PATH }), /not the stored file's/);
  });

  it("sends the signed URL and the key, to the default function or the env's", async () => {
    const { invoke, calls } = fakeInvoke(async () => ok());
    const out = await invokeTopTracksAnalysis({ key: KEY, storagePath: PATH, durationS: 175 }, { env: ON, invoke, sign });
    assert.deepEqual(out.analysis, ANALYSIS);
    assert.equal(out.key, KEY);
    assert.deepEqual(JSON.parse(calls[0]!.payload), { audioUrl: SIGNED, key: KEY });
    assert.equal(calls[0]!.functionName, "top-tracks-analysis");
    await invokeTopTracksAnalysis({ key: KEY, audioUrl: SIGNED }, { env: { ...ON, TOP_TRACKS_ANALYSIS_FUNCTION: "tt-staging" }, invoke });
    assert.equal(calls[1]!.functionName, "tt-staging");
  });

  it("refuses a track over the host's limit without a call", async () => {
    const { invoke, calls } = fakeInvoke(async () => ok());
    await rejectsKind(invokeTopTracksAnalysis({ key: KEY, storagePath: PATH, durationS: MAX_AUDIO_SECONDS + 1 }, { env: ON, invoke, sign }), "too_long");
    assert.equal(calls.length, 0);
  });

  it("refuses a reply for another file version", async () => {
    const { invoke } = fakeInvoke(async () => ok(`${DRIVE_ID}@2026-11-19T00:00:00.000Z`));
    await rejectsKind(invokeTopTracksAnalysis({ key: KEY, storagePath: PATH }, { env: ON, invoke, sign }), "bad_response");
  });
});

describe("failures", () => {
  const run = (answer: Parameters<typeof fakeInvoke>[0], extra: { timeoutMs?: number } = {}) => invokeTopTracksAnalysis({ key: KEY, storagePath: PATH }, { env: ON, invoke: fakeInvoke(answer).invoke, sign, ...extra });

  it("passes the handler's own kinds through; an unknown kind reads as analysis", async () => {
    for (const kind of ["bad_request", "too_long", "audio", "analysis"]) await rejectsKind(run(async () => reply({ ok: false, key: KEY, kind, error: "x" })), kind);
    await rejectsKind(run(async () => reply({ ok: false, key: KEY, kind: "weird", error: "x" })), "analysis");
  });

  it("Lambda's own timeout is a timeout; any other unhandled error is function_error", async () => {
    await rejectsKind(run(async () => reply({ errorMessage: "2026-11-18T10:10:00Z abc Task timed out after 600.00 seconds" }, "Unhandled")), "timeout");
    await rejectsKind(run(async () => reply({ errorMessage: "Runtime exited with error: signal: killed", errorType: "Runtime.ExitError" }, "Unhandled")), "function_error");
  });

  it("our own deadline aborts the call", async () => {
    let aborted = false;
    const hang: Parameters<typeof fakeInvoke>[0] = ({ signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          aborted = true;
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        });
      });
    await rejectsKind(run(hang, { timeoutMs: 20 }), "timeout");
    assert.equal(aborted, true);
  });

  it("the concurrency cap is throttled (the only retryable kind); a missing function is not_deployed", async () => {
    await assert.rejects(run(async () => Promise.reject(Object.assign(new Error("Rate Exceeded."), { name: "TooManyRequestsException" }))), (e: unknown) => e instanceof TopTracksAnalysisError && e.kind === "throttled" && e.retryable);
    await assert.rejects(run(async () => Promise.reject(Object.assign(new Error("Function not found"), { name: "ResourceNotFoundException" }))), (e: unknown) => e instanceof TopTracksAnalysisError && e.kind === "not_deployed" && !e.retryable);
    await rejectsKind(run(async () => Promise.reject(new Error("socket hang up"))), "invoke");
  });

  it("a malformed reply is bad_response", async () => {
    await rejectsKind(run(async () => ({ payload: "<html>" })), "bad_response");
    await rejectsKind(run(async () => reply({ ok: true, key: KEY, analysis: { ...ANALYSIS, bassBeatDb: [1] } })), "bad_response");
    await rejectsKind(run(async () => reply({ ok: true, key: KEY, analysis: { ...ANALYSIS, beats: [0.5, Number.NaN, 1] } })), "bad_response");
    await rejectsKind(run(async () => reply({ ok: true, key: KEY, analysis: { ...ANALYSIS, durationS: 0 } })), "bad_response");
  });

  it("a Storage path needs a signer", async () => {
    await rejectsKind(invokeTopTracksAnalysis({ key: KEY, storagePath: PATH }, { env: ON, invoke: async () => ok() }), "bad_request");
  });
});

describe("the Lambda client's config", () => {
  const creds = { REMOTION_AWS_ACCESS_KEY_ID: "AKIA-test", REMOTION_AWS_SECRET_ACCESS_KEY: "secret-test" };

  it("makes one attempt and waits past the function's own timeout", () => {
    const c = lambdaClientConfig({ ...creds, REMOTION_AWS_REGION: "eu-west-2" });
    assert.equal(c.maxAttempts, 1);
    assert.equal(c.region, "eu-west-2");
    assert.ok(c.requestHandler.requestTimeout > FUNCTION_TIMEOUT_SECONDS * 1000);
    assert.equal(c.requestHandler.requestTimeout, CLIENT_TIMEOUT_MS);
  });

  it("refuses another region and missing keys", () => {
    assert.throws(() => lambdaClientConfig({ ...creds, REMOTION_AWS_REGION: "us-east-1" }), /eu-west-2/);
    assert.throws(() => lambdaClientConfig({ REMOTION_AWS_REGION: "eu-west-2" }), /not set/);
  });
});

describe("lambdaStudio", () => {
  it("reads the Lab's Storage copy, not the local file", async () => {
    const { invoke, calls } = fakeInvoke(async () => ok());
    const studio = lambdaStudio({ env: ON, invoke, sign });
    assert.equal(studio.remote, true);
    assert.deepEqual(await studio.analyse("/tmp/source.mp3", { storagePath: PATH, key: KEY }), ANALYSIS);
    await rejectsKind(studio.analyse("/tmp/source.mp3"), "bad_request");
    assert.equal(calls.length, 1);
  });
});

// ---------------------------------------------------------------------------
// TK18 over migration 262's columns.

type Row = Record<string, unknown> & { id: string };

function row(over: Record<string, unknown> = {}): Row {
  return { id: "row-1", storage_path: PATH, duration_s: "175.000", drop_source: null, created_at: "2026-11-18T09:00:00Z", analysis: null, analysis_key: null, analysis_state: null, ...over };
}

/** A Supabase stand-in for the store: select / update with eq, is (also on analysis->running and ->>startedAt), order, limit. */
function fakeDb(rows: Row[]) {
  const writes: Record<string, unknown>[] = [];
  const read = (r: Row, col: string): unknown => {
    if (col === "analysis->running") return (r.analysis as { running?: unknown } | null)?.running ?? null;
    if (col === "analysis->running->>startedAt") return (r.analysis as { running?: { startedAt?: string } } | null)?.running?.startedAt ?? null;
    return r[col];
  };
  const from = () => {
    let op: "select" | "update" = "select";
    let values: Record<string, unknown> = {};
    const filters: ((r: Row) => boolean)[] = [];
    let limit = Infinity;
    let one = false;
    const exec = () => {
      const hit = rows.filter((r) => filters.every((f) => f(r))).slice(0, limit);
      if (op === "update") {
        for (const r of hit) Object.assign(r, structuredClone(values));
        writes.push(values);
      }
      const data = hit.map((r) => ({ ...r }));
      return { data: one ? (data[0] ?? null) : data, error: null };
    };
    const q = {
      select: () => q,
      update: (v: Record<string, unknown>) => ((op = "update"), (values = v), q),
      eq: (col: string, val: unknown) => (filters.push((r) => read(r, col) === val), q),
      is: (col: string, val: null) => (filters.push((r) => (read(r, col) ?? null) === val), q),
      order: () => q,
      limit: (n: number) => ((limit = n), q),
      maybeSingle: () => ((one = true), Promise.resolve(exec())),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(exec()).then(res, rej),
    };
    return q;
  };
  return { db: { from }, rows, writes };
}

const T0 = new Date("2026-11-18T10:00:00.000Z");
const at = (ms: number) => () => new Date(T0.getTime() + ms);

describe("decideAnalysis", () => {
  const s = (analysisKey: string | null, analysisState: "running" | "done" | "failed" | null, analysis: unknown = null) => ({ analysisKey, analysisState, analysis });
  it("runs a new version, keeps a finished one, waits on a live claim, takes over a stale one", () => {
    assert.equal(decideAnalysis(s(null, null), KEY, T0), "run");
    assert.equal(decideAnalysis(s(`${DRIVE_ID}@older`, "done"), KEY, T0), "run");
    assert.equal(decideAnalysis(s(KEY, "done"), KEY, T0), "use_stored");
    assert.equal(decideAnalysis(s(KEY, "failed"), KEY, T0), "use_stored");
    assert.equal(decideAnalysis(s(KEY, "running", { v: 2, queued: { at: T0.toISOString() } }), KEY, T0), "run");
    assert.equal(decideAnalysis(s(KEY, "running", { v: 2, running: { startedAt: T0.toISOString() } }), KEY, at(RUNNING_STALE_MS - 1)()), "busy");
    assert.equal(decideAnalysis(s(KEY, "running", { v: 2, running: { startedAt: T0.toISOString() } }), KEY, at(RUNNING_STALE_MS)()), "run");
  });
});

describe("analyseOnce (once per file version, stored)", () => {
  it("a new version runs once and is stored done; the same version is then read back, not run", async () => {
    const f = fakeDb([row({ analysis_key: `${DRIVE_ID}@older`, analysis_state: "done", analysis: { v: 2, old: true } })]);
    const store = supabaseAnalysisStore(f.db);
    let runs = 0;
    const run = async () => (runs++, ANALYSIS);
    const first = await analyseOnce({ store, rowId: "row-1", key: KEY, run, now: at(0) });
    assert.equal(first.outcome, "done");
    assert.equal(first.outcome === "done" && first.written, true);
    assert.equal(f.rows[0]!.analysis_state, "done");
    assert.equal(f.rows[0]!.analysis_key, KEY);
    assert.deepEqual(f.rows[0]!.analysis, { v: 2, ...ANALYSIS });
    const second = await analyseOnce({ store, rowId: "row-1", key: KEY, run, now: at(1000) });
    assert.equal(second.outcome, "stored");
    assert.equal(runs, 1);
  });

  it("onDone sets the stored shape and extra columns (how #1342 writes snippetDropFrom's)", async () => {
    const f = fakeDb([row()]);
    await analyseOnce({ store: supabaseAnalysisStore(f.db), rowId: "row-1", key: KEY, run: async () => ANALYSIS, onDone: (a) => ({ analysis: { v: 2, ...a, R: -14 }, drop_s: 127.5 }), now: at(0) });
    assert.equal(f.rows[0]!.drop_s, 127.5);
    assert.equal((f.rows[0]!.analysis as { R: number }).R, -14);
  });

  it("a failure is stored as TK18's failed state with its kind, and not retried for that version", async () => {
    const f = fakeDb([row()]);
    const store = supabaseAnalysisStore(f.db);
    const out = await analyseOnce({ store, rowId: "row-1", key: KEY, run: async () => Promise.reject(new TopTracksAnalysisError("audio", "the audio file could not be decoded")), now: at(0) });
    assert.equal(out.outcome, "failed");
    assert.equal(f.rows[0]!.analysis_state, "failed");
    assert.deepEqual(f.rows[0]!.analysis, { v: 2, error: "the audio file could not be decoded", kind: "audio" });
    let runs = 0;
    assert.equal((await analyseOnce({ store, rowId: "row-1", key: KEY, run: async () => (runs++, ANALYSIS), now: at(1000) })).outcome, "stored");
    assert.equal(runs, 0);
  });

  it("a live claim is busy; a stale one (its worker died) is taken over", async () => {
    const claimed = { analysis_key: KEY, analysis_state: "running", analysis: { v: 2, running: { startedAt: T0.toISOString() } } };
    const f = fakeDb([row(claimed)]);
    const store = supabaseAnalysisStore(f.db);
    assert.equal((await analyseOnce({ store, rowId: "row-1", key: KEY, run: async () => ANALYSIS, now: at(60_000) })).outcome, "busy");
    assert.equal((await analyseOnce({ store, rowId: "row-1", key: KEY, run: async () => ANALYSIS, now: at(RUNNING_STALE_MS + 1) })).outcome, "done");
    assert.equal(f.rows[0]!.analysis_state, "done");
  });

  it("loses the claim to a write between the read and the claim", async () => {
    const f = fakeDb([row(queuedAnalysisColumns(KEY, T0))]);
    const real = supabaseAnalysisStore(f.db);
    const store = { ...real, read: async (id: string) => {
      const r = await real.read(id);
      f.rows[0]!.analysis = { v: 2, running: { startedAt: "2026-11-18T09:59:59.000Z" } }; // another worker claims it
      return r;
    } };
    let runs = 0;
    assert.equal((await analyseOnce({ store, rowId: "row-1", key: KEY, run: async () => (runs++, ANALYSIS), now: at(0) })).outcome, "busy");
    assert.equal(runs, 0);
  });

  it("doesn't overwrite a newer file version that arrived mid-run", async () => {
    const f = fakeDb([row(queuedAnalysisColumns(KEY, T0))]);
    const newer = `${DRIVE_ID}@2026-11-19T00:00:00.000Z`;
    const out = await analyseOnce({
      store: supabaseAnalysisStore(f.db),
      rowId: "row-1",
      key: KEY,
      now: at(0),
      run: async () => {
        Object.assign(f.rows[0]!, queuedAnalysisColumns(newer, T0)); // the intake saw a new modifiedTime
        return ANALYSIS;
      },
    });
    assert.equal(out.outcome === "done" && out.written, false);
    assert.equal(f.rows[0]!.analysis_key, newer);
    assert.equal(f.rows[0]!.analysis_state, "running");
  });

  it("a throttled call (the concurrency cap) queues the row again instead of failing it", async () => {
    const f = fakeDb([row(queuedAnalysisColumns(KEY, T0))]);
    const out = await analyseOnce({ store: supabaseAnalysisStore(f.db), rowId: "row-1", key: KEY, now: at(5000), run: async () => Promise.reject(new TopTracksAnalysisError("throttled", "busy")) });
    assert.equal(out.outcome, "throttled");
    assert.equal(f.rows[0]!.analysis_state, "running");
    assert.deepEqual(f.rows[0]!.analysis, { v: 2, queued: { at: at(5000)().toISOString() } });
  });

  it("a missing row is missing", async () => {
    assert.equal((await analyseOnce({ store: supabaseAnalysisStore(fakeDb([]).db), rowId: "row-1", key: KEY, run: async () => ANALYSIS })).outcome, "missing");
  });
});

describe("runAnalysisTick", () => {
  it("invokes at most the reserved concurrency at once, oldest queued first, and skips live claims", async () => {
    const key = (n: number) => `${DRIVE_ID}${n}@2026-11-18T10:00:00.000Z`;
    const rows = [1, 2, 3].map((n) => row({ id: `row-${n}`, storage_path: `audio/creative-lab/ev-1/${DRIVE_ID}${n}.wav`, ...queuedAnalysisColumns(key(n), T0) }));
    rows.unshift(row({ id: "row-0", analysis_key: key(0), analysis_state: "running", analysis: { v: 2, running: { startedAt: T0.toISOString() } } }));
    const f = fakeDb(rows);
    const { invoke, calls } = fakeInvoke(async (call) => ok(JSON.parse(call.payload).key));
    const seen: { durationS: number | null; dropSource: string | null }[] = [];
    const out = await runAnalysisTick({
      store: supabaseAnalysisStore(f.db),
      client: { env: ON, invoke, sign: async (p) => `https://x.supabase.co/${p}` },
      limit: 5,
      now: at(1000),
      onDone: (a, r) => (seen.push({ durationS: r.durationS, dropSource: r.dropSource }), { analysis: { v: 2, ...a } }),
    });
    assert.deepEqual(seen[0], { durationS: 175, dropSource: null });
    assert.equal(FUNCTION_RESERVED_CONCURRENCY, 2);
    assert.equal(calls.length, 2);
    assert.deepEqual(out.outcomes.map((o) => [o.rowId, o.outcome]), [["row-1", "done"], ["row-2", "done"]]);
    assert.equal(f.rows.find((r) => r.id === "row-3")!.analysis_state, "running");
    assert.equal(f.rows.find((r) => r.id === "row-0")!.analysis_state, "running");
  });

  it("a row with no Storage copy is stored failed", async () => {
    const f = fakeDb([row({ storage_path: null, ...queuedAnalysisColumns(KEY, T0) })]);
    const out = await runAnalysisTick({ store: supabaseAnalysisStore(f.db), client: { env: ON, invoke: async () => ok(), sign }, now: at(0) });
    assert.deepEqual(out.outcomes, [{ rowId: "row-1", outcome: "failed", kind: "bad_request" }]);
    assert.equal(f.rows[0]!.analysis_state, "failed");
  });
});
