/**
 * TK13, TK14, TK18 (docs/design-record/2026-11-18-creative-lab-top-tracks-2.html):
 * the Top tracks analysis host. Beat This! (final0) and Demucs (htdemucs)
 * run in a container Lambda in eu-west-2 (infra/top-tracks-analysis,
 * deployed by scripts/top-tracks-analysis-deploy.mts), because torch does
 * not run on Vercel. One synchronous call per audio file version; the
 * result is about 10 KB of JSON (beats, downbeats, per-beat bass levels),
 * never the stem's audio.
 *
 * Off unless ENABLE_TOP_TRACKS_ANALYSIS is exactly "1": with the flag off
 * nothing signs a URL or calls AWS, and every caller gets kind "disabled"
 * (TK18's failed line, the operator's drop cuts on seconds).
 *
 *   invokeTopTracksAnalysis  sign the Storage path (or take a signed URL), invoke, check the reply
 *   lambdaStudio             the same as a StudioSource (PR #1342's analysis-source.ts)
 *   analyseOnce              TK18's "once per file version", over an AnalysisStore
 *   runAnalysisTick          the queued rows, at most the function's reserved concurrency at once
 *   supabaseAnalysisStore    the store on creative_lab_audio_files.analysis / analysis_key /
 *                            analysis_state (migration 262, PR #1342; not applied on main)
 *
 * Credentials are the Remotion IAM user's (REMOTION_AWS_ACCESS_KEY_ID /
 * REMOTION_AWS_SECRET_ACCESS_KEY, REMOTION_AWS_REGION), which the deploy
 * script grants lambda:InvokeFunction on this one function.
 * docs/TOP_TRACKS_ANALYSIS_LAMBDA_SETUP.md has the runbook.
 */

type Env = Record<string, string | undefined>;

export const TOP_TRACKS_ANALYSIS_REGION = "eu-west-2" as const;
export const TOP_TRACKS_ANALYSIS_FUNCTION_DEFAULT = "top-tracks-analysis";
/** A 5-min track at 1.1x real time is 5.5 min; 600 s leaves room for a cold start and an 8-min track (MAX_AUDIO_SECONDS). */
export const FUNCTION_TIMEOUT_SECONDS = 600;
export const FUNCTION_MEMORY_MB = 4096;
export const FUNCTION_EPHEMERAL_MB = 1024;
/** The cap: at most this many analyses run at once, account-wide. */
export const FUNCTION_RESERVED_CONCURRENCY = 2;
/** The handler refuses longer audio (its MAX_AUDIO_SECONDS); the client doesn't call for it. */
export const MAX_AUDIO_SECONDS = 480;
/** Longer than the function's own timeout, so Lambda's "Task timed out" reaches us rather than our abort. */
export const CLIENT_TIMEOUT_MS = (FUNCTION_TIMEOUT_SECONDS + 20) * 1000;
/** A claimed row whose worker died (Vercel's 800 s cap) is taken over after this. */
export const RUNNING_STALE_MS = 15 * 60 * 1000;

/** Storage paths the client signs: the Lab's copy of an audio file (audio-intake.ts's audioStoragePath). */
const STORAGE_PREFIX = "audio/creative-lab/";
/** analysisKey() in PR #1342's analysis-source.ts: `${driveFileId}@${modifiedTime ?? "unknown"}`. The handler checks the same. */
const KEY_RE = /^([A-Za-z0-9_-]{10,200})@([A-Za-z0-9:.+_-]{1,64})$/;
const MAX_REPLY_BYTES = 1024 * 1024;

/** Structurally PR #1342's StudioAnalysis (studio.ts). */
export type StudioAnalysisShape = {
  durationS: number;
  beats: number[];
  downbeats: number[];
  /** The bass stem's level from beats[i] to beats[i + 1], dB. */
  bassBeatDb: number[];
};

export type AnalysisErrorKind =
  | "disabled"
  | "bad_request"
  | "too_long"
  | "audio"
  | "analysis"
  | "throttled"
  | "timeout"
  | "not_deployed"
  | "function_error"
  | "bad_response"
  | "invoke";

const HANDLED_KINDS: ReadonlySet<string> = new Set(["bad_request", "too_long", "audio", "analysis"]);

export class TopTracksAnalysisError extends Error {
  readonly kind: AnalysisErrorKind;
  /** Only a throttle (the concurrency cap) is worth retrying for the same file version. */
  readonly retryable: boolean;
  constructor(kind: AnalysisErrorKind, message: string) {
    super(message.slice(0, 300));
    this.name = "TopTracksAnalysisError";
    this.kind = kind;
    this.retryable = kind === "throttled";
  }
}

export function isTopTracksAnalysisEnabled(env: Env = process.env): boolean {
  return env.ENABLE_TOP_TRACKS_ANALYSIS === "1";
}

export function topTracksAnalysisFunction(env: Env = process.env): string {
  return env.TOP_TRACKS_ANALYSIS_FUNCTION?.trim() || TOP_TRACKS_ANALYSIS_FUNCTION_DEFAULT;
}

export type AnalysisRequest = {
  /** TK18's key, `${driveFileId}@${Drive modifiedTime}`. */
  key: string;
  /** The Lab's Storage copy (signed here), or ... */
  storagePath?: string | null;
  /** ... an already-signed https URL. Exactly one of the two. */
  audioUrl?: string | null;
  /** The probed duration, when known: over MAX_AUDIO_SECONDS is refused without a call. */
  durationS?: number | null;
};

/** Checks a request and returns its key's parts. Throws kind "bad_request". */
export function validateAnalysisRequest(req: AnalysisRequest): { key: string; driveFileId: string; source: { storagePath: string } | { audioUrl: string } } {
  const m = typeof req?.key === "string" ? KEY_RE.exec(req.key) : null;
  if (!m) throw new TopTracksAnalysisError("bad_request", "key must be <drive_file_id>@<modified time>");
  const driveFileId = m[1]!;
  const hasPath = typeof req.storagePath === "string" && req.storagePath.length > 0;
  const hasUrl = typeof req.audioUrl === "string" && req.audioUrl.length > 0;
  if (hasPath === hasUrl) throw new TopTracksAnalysisError("bad_request", "give a storagePath or an audioUrl, not both");
  if (hasUrl) {
    let url: URL;
    try {
      url = new URL(req.audioUrl!);
    } catch {
      throw new TopTracksAnalysisError("bad_request", "audioUrl is not a URL");
    }
    if (url.protocol !== "https:" || url.username || url.password) throw new TopTracksAnalysisError("bad_request", "audioUrl must be a plain https URL");
    return { key: req.key, driveFileId, source: { audioUrl: req.audioUrl! } };
  }
  const p = req.storagePath!;
  if (p.length > 1024 || !p.startsWith(STORAGE_PREFIX) || p.includes("..") || /[?#\\\s]/.test(p)) {
    throw new TopTracksAnalysisError("bad_request", `storagePath must be the Lab's copy under ${STORAGE_PREFIX}`);
  }
  // The key and the file must be the same Drive file: audioStoragePath names the copy by its Drive id.
  const base = p.slice(p.lastIndexOf("/") + 1);
  const stem = base.includes(".") ? base.slice(0, base.lastIndexOf(".")) : base;
  if (stem !== driveFileId) throw new TopTracksAnalysisError("bad_request", "the key's Drive id is not the stored file's");
  return { key: req.key, driveFileId, source: { storagePath: p } };
}

const finiteList = (v: unknown): v is number[] => Array.isArray(v) && v.every((x) => typeof x === "number" && Number.isFinite(x));

/** The handler's analysis, checked as PR #1342's parseAnalysis checks analyse.py's. */
export function parseAnalysisReply(raw: unknown): StudioAnalysisShape {
  const j = (raw ?? {}) as Partial<StudioAnalysisShape>;
  if (typeof j.durationS !== "number" || !(j.durationS > 0) || !finiteList(j.beats) || !finiteList(j.downbeats) || !finiteList(j.bassBeatDb) || j.beats.length !== j.bassBeatDb.length) {
    throw new TopTracksAnalysisError("bad_response", "the analysis host returned an unexpected shape");
  }
  return { durationS: j.durationS, beats: j.beats, downbeats: j.downbeats, bassBeatDb: j.bassBeatDb };
}

export type LambdaInvoke = (call: { functionName: string; payload: string; signal: AbortSignal; tail?: boolean }) => Promise<{ statusCode?: number; functionError?: string; payload: string; logTail?: string }>;

export type AnalysisClientDeps = {
  /** Default: lambdaInvoker() on the Remotion IAM user's keys. */
  invoke?: LambdaInvoke;
  /** Signs a Storage path for the function to read (snippet-server.ts's signedUrl on AUDIO_BUCKET). */
  sign?: (storagePath: string) => Promise<string>;
  env?: Env;
  timeoutMs?: number;
  /** Ask for the last 4 KB of the call's log (the test-invoke script prints Lambda's REPORT line). */
  tail?: boolean;
};

export type AnalysisReply = { key: string; analysis: StudioAnalysisShape; timingsS: Record<string, number>; logTail?: string };

function errorName(err: unknown): string {
  return err && typeof err === "object" && "name" in err ? String((err as { name: unknown }).name) : "";
}

/** One synchronous call. Throws TopTracksAnalysisError for every failure. */
export async function invokeTopTracksAnalysis(req: AnalysisRequest, deps: AnalysisClientDeps = {}): Promise<AnalysisReply> {
  const env = deps.env ?? process.env;
  if (!isTopTracksAnalysisEnabled(env)) throw new TopTracksAnalysisError("disabled", "the Top tracks analysis host is switched off (ENABLE_TOP_TRACKS_ANALYSIS)");
  const valid = validateAnalysisRequest(req);
  if (typeof req.durationS === "number" && req.durationS > MAX_AUDIO_SECONDS) {
    throw new TopTracksAnalysisError("too_long", `the track is ${Math.round(req.durationS)} s; the host reads up to ${MAX_AUDIO_SECONDS} s`);
  }
  let audioUrl: string;
  if ("audioUrl" in valid.source) {
    audioUrl = valid.source.audioUrl;
  } else {
    if (!deps.sign) throw new TopTracksAnalysisError("bad_request", "no signer for the Storage path");
    audioUrl = await deps.sign(valid.source.storagePath);
  }
  const invoke = deps.invoke ?? lambdaInvoker(env);
  const timeoutMs = deps.timeoutMs ?? CLIENT_TIMEOUT_MS;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  let res: Awaited<ReturnType<LambdaInvoke>>;
  try {
    res = await invoke({ functionName: topTracksAnalysisFunction(env), payload: JSON.stringify({ audioUrl, key: valid.key }), signal: abort.signal, tail: deps.tail });
  } catch (err) {
    if (err instanceof TopTracksAnalysisError) throw err;
    const name = errorName(err);
    if (abort.signal.aborted || name === "AbortError") throw new TopTracksAnalysisError("timeout", `no reply from the analysis host in ${Math.round(timeoutMs / 1000)} s`);
    if (name === "TooManyRequestsException") throw new TopTracksAnalysisError("throttled", "the analysis host is busy (its concurrency cap); try again shortly");
    if (name === "ResourceNotFoundException") throw new TopTracksAnalysisError("not_deployed", "the analysis function is not deployed (scripts/top-tracks-analysis-deploy.mts)");
    throw new TopTracksAnalysisError("invoke", `invoking the analysis host failed: ${name || "error"}`);
  } finally {
    clearTimeout(timer);
  }
  if (res.payload.length > MAX_REPLY_BYTES) throw new TopTracksAnalysisError("bad_response", "the analysis host's reply is too large");
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(res.payload) as Record<string, unknown>;
  } catch {
    throw new TopTracksAnalysisError("bad_response", "the analysis host's reply is not JSON");
  }
  if (res.functionError) {
    const message = typeof body?.errorMessage === "string" ? body.errorMessage : res.functionError;
    if (/Task timed out/i.test(message)) throw new TopTracksAnalysisError("timeout", `the analysis host timed out (${FUNCTION_TIMEOUT_SECONDS} s)`);
    throw new TopTracksAnalysisError("function_error", `the analysis host failed: ${message}`);
  }
  if (body?.ok !== true) {
    const kind = typeof body?.kind === "string" && HANDLED_KINDS.has(body.kind) ? (body.kind as AnalysisErrorKind) : "analysis";
    throw new TopTracksAnalysisError(kind, typeof body?.error === "string" ? body.error : "the analysis host could not read the track");
  }
  if (body.key !== valid.key) throw new TopTracksAnalysisError("bad_response", "the analysis host answered for a different file version");
  const timings = body.timingsS && typeof body.timingsS === "object" ? (body.timingsS as Record<string, number>) : {};
  return { key: valid.key, analysis: parseAnalysisReply(body.analysis), timingsS: timings, ...(res.logTail ? { logTail: res.logTail } : {}) };
}

/** The Lambda client's settings: one attempt (a retried 600 s call is paid twice), and a socket that outlives the call. */
export function lambdaClientConfig(env: Env = process.env) {
  const accessKeyId = env.REMOTION_AWS_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.REMOTION_AWS_SECRET_ACCESS_KEY?.trim();
  const region = env.REMOTION_AWS_REGION?.trim() || TOP_TRACKS_ANALYSIS_REGION;
  if (region !== TOP_TRACKS_ANALYSIS_REGION) throw new TopTracksAnalysisError("invoke", `REMOTION_AWS_REGION is ${region}; the analysis host is in ${TOP_TRACKS_ANALYSIS_REGION}`);
  if (!accessKeyId || !secretAccessKey) throw new TopTracksAnalysisError("invoke", "REMOTION_AWS_ACCESS_KEY_ID / REMOTION_AWS_SECRET_ACCESS_KEY are not set");
  return {
    region,
    credentials: { accessKeyId, secretAccessKey },
    maxAttempts: 1,
    requestHandler: { requestTimeout: CLIENT_TIMEOUT_MS, connectionTimeout: 10_000 },
  };
}

/** Invokes through @aws-sdk/client-lambda, loaded on first use. */
export function lambdaInvoker(env: Env = process.env): LambdaInvoke {
  let client: import("@aws-sdk/client-lambda").LambdaClient | null = null;
  return async ({ functionName, payload, signal, tail }) => {
    const sdk = await import("@aws-sdk/client-lambda");
    client ??= new sdk.LambdaClient(lambdaClientConfig(env));
    const out = await client.send(new sdk.InvokeCommand({ FunctionName: functionName, InvocationType: "RequestResponse", LogType: tail ? "Tail" : "None", Payload: new TextEncoder().encode(payload) }), { abortSignal: signal });
    return {
      statusCode: out.StatusCode,
      functionError: out.FunctionError,
      payload: out.Payload ? new TextDecoder().decode(out.Payload) : "",
      ...(out.LogResult ? { logTail: Buffer.from(out.LogResult, "base64").toString("utf8") } : {}),
    };
  };
}

/** The file being analysed: what PR #1342's readAudioFile has once it has copied the file to Storage. */
export type RemoteAnalysisContext = { storagePath: string; key: string; durationS?: number | null };

/**
 * A StudioSource (PR #1342's analysis-source.ts) on the host. `remote: true`
 * tells the intake not to call it inline (a whole track takes 2–5 min, past
 * the scan routes' 300 s) but to queue the row for runAnalysisTick.
 */
export function lambdaStudio(deps: AnalysisClientDeps & { sign: (storagePath: string) => Promise<string> }) {
  return {
    name: "Beat This! final0 + htdemucs (Lambda)",
    remote: true as const,
    async analyse(_audioFile: string, ctx?: RemoteAnalysisContext): Promise<StudioAnalysisShape> {
      if (!ctx) throw new TopTracksAnalysisError("bad_request", "the Lambda source reads the Lab's Storage copy: pass { storagePath, key }");
      return (await invokeTopTracksAnalysis({ key: ctx.key, storagePath: ctx.storagePath, durationS: ctx.durationS }, deps)).analysis;
    },
  };
}

// ---------------------------------------------------------------------------
// TK18: once per file version, stored with the file.

export type AnalysisState = "running" | "done" | "failed";
export type StoredAnalysis = { analysisKey: string | null; analysisState: AnalysisState | null; analysis: unknown };

/** The marker on a row that is waiting ("queued") or claimed by a worker ("running"). */
type RunningMarker = { v: 2; queued?: { at: string }; running?: { startedAt: string } };

function startedAtOf(analysis: unknown): string | null {
  const s = (analysis as RunningMarker | null)?.running?.startedAt;
  return typeof s === "string" ? s : null;
}

/** The columns the intake writes when a file is first offered or its version changes: "Finding the drops…". */
export function queuedAnalysisColumns(key: string, now: Date = new Date()) {
  return { analysis_key: key, analysis_state: "running" as const, analysis: { v: 2, queued: { at: now.toISOString() } } satisfies RunningMarker };
}

export type AnalysisDecision = "run" | "use_stored" | "busy";

/**
 * TK18: a new key runs; the same key done or failed is kept (a failed version
 * waits for the operator's drop or a new file version); a queued row runs; a
 * claimed row is busy until RUNNING_STALE_MS, then taken over.
 */
export function decideAnalysis(current: StoredAnalysis, key: string, now: Date, staleMs = RUNNING_STALE_MS): AnalysisDecision {
  if (current.analysisKey !== key) return "run";
  if (current.analysisState === "done" || current.analysisState === "failed") return "use_stored";
  if (current.analysisState === "running") {
    const started = startedAtOf(current.analysis);
    if (!started) return "run";
    const t = Date.parse(started);
    return Number.isFinite(t) && now.getTime() - t < staleMs ? "busy" : "run";
  }
  return "run";
}

/** dropSource (migration 255): an operator's drop is kept; onDone writes the Lab's drop only when it isn't "operator". */
export type PendingAnalysisRow = StoredAnalysis & { id: string; storagePath: string | null; durationS: number | null; dropSource: "lab" | "operator" | null };

export interface AnalysisStore {
  read(rowId: string): Promise<StoredAnalysis | null>;
  /** Rows waiting or stale (state running), oldest first. */
  pending(limit: number): Promise<PendingAnalysisRow[]>;
  /** Marks the row running for `key`, only if it still reads `prev`. False when someone else got there first. */
  claim(rowId: string, key: string, prev: StoredAnalysis, startedAt: string): Promise<boolean>;
  /** Writes the outcome, only if this claim still holds. False when a newer version or a takeover replaced it. */
  finish(rowId: string, key: string, startedAt: string, columns: Record<string, unknown>): Promise<boolean>;
  /** Queues the row again (a throttled call), only if this claim still holds. */
  release(rowId: string, key: string, startedAt: string, now: Date): Promise<void>;
}

export type AnalyseOnceOutcome =
  | { outcome: "missing" }
  | { outcome: "busy" }
  | { outcome: "stored"; state: AnalysisState | null; analysis: unknown }
  | { outcome: "done"; analysis: StudioAnalysisShape; written: boolean }
  | { outcome: "failed"; kind: AnalysisErrorKind; error: string; written: boolean }
  | { outcome: "throttled" };

/** Default stored shape: migration 262's {v: 2, ...}. #1342 passes snippetDropFrom's (R, drops, grid) and the drop columns. */
const defaultOnDone = (a: StudioAnalysisShape): Record<string, unknown> => ({ analysis: { v: 2, ...a } });

export async function analyseOnce(input: {
  store: AnalysisStore;
  rowId: string;
  key: string;
  run: () => Promise<StudioAnalysisShape>;
  onDone?: (analysis: StudioAnalysisShape) => Record<string, unknown>;
  now?: () => Date;
}): Promise<AnalyseOnceOutcome> {
  const now = input.now ?? (() => new Date());
  const current = await input.store.read(input.rowId);
  if (!current) return { outcome: "missing" };
  const decision = decideAnalysis(current, input.key, now());
  if (decision === "use_stored") return { outcome: "stored", state: current.analysisState, analysis: current.analysis };
  if (decision === "busy") return { outcome: "busy" };
  const startedAt = now().toISOString();
  if (!(await input.store.claim(input.rowId, input.key, current, startedAt))) return { outcome: "busy" };
  try {
    const analysis = await input.run();
    const columns = { ...(input.onDone ?? defaultOnDone)(analysis), analysis_state: "done" };
    return { outcome: "done", analysis, written: await input.store.finish(input.rowId, input.key, startedAt, columns) };
  } catch (err) {
    const e = err instanceof TopTracksAnalysisError ? err : new TopTracksAnalysisError("analysis", err instanceof Error ? err.message : String(err));
    if (e.retryable) {
      await input.store.release(input.rowId, input.key, startedAt, now());
      return { outcome: "throttled" };
    }
    // TK18: "Couldn't read this track's beat — drag the drop marker to it."
    const written = await input.store.finish(input.rowId, input.key, startedAt, { analysis: { v: 2, error: e.message, kind: e.kind }, analysis_state: "failed" });
    return { outcome: "failed", kind: e.kind, error: e.message, written };
  }
}

export type AnalysisTickResult = { considered: number; outcomes: { rowId: string; outcome: AnalyseOnceOutcome["outcome"]; kind?: AnalysisErrorKind }[]; skippedReason?: "disabled" };

/**
 * For a cron with room for a whole call (the render tick's maxDuration is
 * 800 s): the queued rows, at most `limit` at once (the reserved concurrency),
 * each through analyseOnce.
 */
export async function runAnalysisTick(input: {
  store: AnalysisStore;
  client: AnalysisClientDeps;
  onDone?: (analysis: StudioAnalysisShape, row: PendingAnalysisRow) => Record<string, unknown>;
  limit?: number;
  now?: () => Date;
}): Promise<AnalysisTickResult> {
  if (!isTopTracksAnalysisEnabled(input.client.env ?? process.env)) return { considered: 0, outcomes: [], skippedReason: "disabled" };
  const now = input.now ?? (() => new Date());
  const limit = Math.max(1, Math.min(input.limit ?? FUNCTION_RESERVED_CONCURRENCY, FUNCTION_RESERVED_CONCURRENCY));
  const rows = (await input.store.pending(limit * 10)).filter((row) => row.analysisKey && decideAnalysis(row, row.analysisKey, now()) === "run").slice(0, limit);
  const outcomes = await Promise.all(
    rows.map(async (row) => {
      const key = row.analysisKey!;
      const out = await analyseOnce({
        store: input.store,
        rowId: row.id,
        key,
        now,
        onDone: input.onDone ? (a) => input.onDone!(a, row) : undefined,
        run: async () => {
          if (!row.storagePath) throw new TopTracksAnalysisError("bad_request", "the file has no Storage copy");
          return (await invokeTopTracksAnalysis({ key, storagePath: row.storagePath, durationS: row.durationS }, input.client)).analysis;
        },
      });
      return { rowId: row.id, outcome: out.outcome, ...(out.outcome === "failed" ? { kind: out.kind } : {}) };
    }),
  );
  return { considered: rows.length, outcomes };
}

// ---------------------------------------------------------------------------
// The store on creative_lab_audio_files (migration 262, PR #1342).

type Query = {
  select: (cols: string) => Query;
  update: (values: Record<string, unknown>) => Query;
  eq: (col: string, val: unknown) => Query;
  is: (col: string, val: null) => Query;
  order: (col: string, opts: { ascending: boolean }) => Query;
  limit: (n: number) => Query;
  maybeSingle: () => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  then: PromiseLike<{ data: unknown; error: { message: string } | null }>["then"];
};
type Db = { from: (table: string) => unknown };

export const AUDIO_FILES_TABLE = "creative_lab_audio_files";
const STATE_COLUMNS = "id, storage_path, duration_s, drop_source, analysis, analysis_key, analysis_state";

type Row = { id: string; storage_path: string | null; duration_s: number | string | null; drop_source: "lab" | "operator" | null; analysis: unknown; analysis_key: string | null; analysis_state: AnalysisState | null };

const toStored = (row: Row): StoredAnalysis => ({ analysisKey: row.analysis_key, analysisState: row.analysis_state, analysis: row.analysis });

function whereStill(q: Query, col: string, val: string | null): Query {
  return val === null ? q.is(col, null) : q.eq(col, val);
}

/** `prev`'s three columns as conditions, so a claim loses to any write since the read. */
function wherePrev(q: Query, prev: StoredAnalysis): Query {
  let out = whereStill(q, "analysis_key", prev.analysisKey);
  out = whereStill(out, "analysis_state", prev.analysisState);
  if (prev.analysisState === "running") {
    const started = startedAtOf(prev.analysis);
    out = started ? out.eq("analysis->running->>startedAt", started) : out.is("analysis->running", null);
  }
  return out;
}

function mine(q: Query, key: string, startedAt: string): Query {
  return q.eq("analysis_key", key).eq("analysis_state", "running").eq("analysis->running->>startedAt", startedAt);
}

async function updated(q: Query): Promise<number> {
  const { data, error } = await q.select("id");
  if (error) throw new Error(`${AUDIO_FILES_TABLE}: ${error.message}`);
  return Array.isArray(data) ? data.length : 0;
}

export function supabaseAnalysisStore(db: Db, table = AUDIO_FILES_TABLE): AnalysisStore {
  const t = () => db.from(table) as Query;
  return {
    async read(rowId) {
      const { data, error } = await t().select(STATE_COLUMNS).eq("id", rowId).maybeSingle();
      if (error) throw new Error(`${table}: ${error.message}`);
      return data ? toStored(data as Row) : null;
    },
    async pending(limit) {
      const { data, error } = await t().select(STATE_COLUMNS).eq("analysis_state", "running").order("created_at", { ascending: true }).limit(limit);
      if (error) throw new Error(`${table}: ${error.message}`);
      return ((data as Row[] | null) ?? []).map((row) => ({ ...toStored(row), id: row.id, storagePath: row.storage_path, durationS: row.duration_s == null ? null : Number(row.duration_s), dropSource: row.drop_source ?? null }));
    },
    async claim(rowId, key, prev, startedAt) {
      const marker: RunningMarker = { v: 2, running: { startedAt } };
      return (await updated(wherePrev(t().update({ analysis_key: key, analysis_state: "running", analysis: marker }).eq("id", rowId), prev))) === 1;
    },
    async finish(rowId, key, startedAt, columns) {
      return (await updated(mine(t().update(columns).eq("id", rowId), key, startedAt))) === 1;
    },
    async release(rowId, key, startedAt, now) {
      await updated(mine(t().update(queuedAnalysisColumns(key, now)).eq("id", rowId), key, startedAt));
    },
  };
}
