# Top tracks analysis Lambda

**Date:** 18 Nov 2026
**Region:** `eu-west-2`, next to Remotion's function
**Status:** built, not deployed. Matas runs the deploy. Nothing in AWS, Vercel or Supabase was created or changed by this PR.

The Top tracks reel (PR #1342, records TK12–TK18 in `docs/design-record/2026-11-18-creative-lab-top-tracks-2.html`) reads each studio track with two models:
- **Beat This!** (`final0`) on the master, for the beats and downbeats (TK13).
- **Demucs** (`htdemucs`), for the bass stem's level per beat (TK14).

torch doesn't run on Vercel, so the models run in a container-image Lambda. Matas approved the host on 18 Nov. It runs once per audio file version, keyed `{drive_file_id}@{Drive modifiedTime}` (TK18), and its result is stored with the file. It returns about 10 KB of JSON and never the stem's audio.

## Pieces

| Piece | Where |
|---|---|
| Container image: Dockerfile, pinned packages, weights fetch with sha256 check | `infra/top-tracks-analysis/` |
| Handler (input checks, download, decode, both models) | `infra/top-tracks-analysis/app/handler.py`, `app/analysis.py` |
| Handler tests (no torch needed) | `python3 -I infra/top-tracks-analysis/tests/test_handler.py` |
| Smoke test of the full handler outside Lambda | `infra/top-tracks-analysis/smoke.py` |
| Deploy, pause and resume | `scripts/top-tracks-analysis-deploy.mts` |
| One test call, which writes the acceptance script's `--analysis-json` | `scripts/top-tracks-analysis-invoke.mts` |
| App-side client, the store and the tick runner | `lib/creative-tests/top-tracks/lambda-analysis.ts` |
| What the deploy creates, as data (IAM, settings, alarms) | `lib/creative-tests/top-tracks/analysis-host-plan.ts` |

`app/analysis.py` is `scripts/top-tracks/analyse.py`'s `main` (#1342) as a function. The steps, the Demucs settings (`shifts=1`, `split=True`, `overlap=0.25`) and the −120 dB floor are copied unchanged, so the Lambda and the local scripts give the same numbers. Keep the two in step.

## The image

- **arm64** (Graviton). It's 20 % cheaper per GB-second than x86_64, and the build is native on an Apple-silicon Mac, with no emulation.
- Base: `public.ecr.aws/lambda/python:3.12` (Amazon Linux 2023, with the runtime interface client).
- `torch==2.5.1` and `torchaudio==2.5.1` from the PyTorch CPU index (its aarch64 wheel is CPU-only). Everything else is in `infra/top-tracks-analysis/requirements.txt`, pinned to the venv the 18 Nov measurement ran on (`demucs==4.0.1`, `beat-this==1.1.0`, `numpy==2.5.5`, `soundfile==0.14.0`, `soxr==1.1.0`, …). Every pin has an aarch64 or pure-Python wheel on PyPI, except demucs, a pure-Python sdist that needs no compiler.
- Decoding uses libsndfile (bundled in soundfile's manylinux wheel; it reads WAV, AIFF, FLAC and MP3, AU1's formats) plus soxr to 44.1 kHz stereo 16-bit. That is what the local path does with ffmpeg `-ar 44100 -ac 2`. There's no ffmpeg in the image.
- **Weights are fetched at build time** by `fetch_weights.py`, from the official hosts by name, and checked by size and sha256. A mismatch, or a redirect off the host, fails the build:

| File | From | sha256 | Bytes |
|---|---|---|---|
| `955717e8-8726e21a.th` (htdemucs) | `https://dl.fbaipublicfiles.com/demucs/hybrid_transformer/955717e8-8726e21a.th` | `8726e21a993978c7ba086d3872e7608d7d5bfca646ca4aca459ffda844faa8b4` | 84,141,911 |
| `beat_this-final0.ckpt` (final0) | `https://cloud.cp.jku.at/public.php/dav/files/7ik4RrBKTS273gp/final0.ckpt` | `8c328b45f59d8dd3dff219253ff6a8d6482be57d0133a29140e2febbf8eb8331` | 81,058,141 |

  They sit in `/opt/torch/hub/checkpoints` (`TORCH_HOME=/opt/torch`), where torch.hub looks. The handler refuses to start if either file is missing, so nothing is downloaded at run time. Both hosts resolved normally on 18 Nov (HEAD 200, and the htdemucs length matched).
- Expected size: about 1.5–2 GB. ECR keeps the last 3 images (lifecycle policy), at about $0.10 per GB-month.

## The function

| Setting | Value | Why |
|---|---|---|
| Name | `top-tracks-analysis` | It runs both models, so not the write-up's `top-tracks-bass-stem` |
| Memory | 4096 MB | The write-up's figure. Peak RSS was about 2.5 GB on a clip. The test call's REPORT line gives the real peak for a whole track |
| Timeout | **600 s** | Whole tracks run 2–5 min, at the write-up's 0.7–1.1× real time. A 5-min track at 1.1× is 330 s, and the longest accepted track (480 s) at 1.1× is 528 s. Add a cold start (image pull plus model load, about 10–30 s) and download/decode (about 5 s) and 600 s still leaves headroom. The study's 300 s is too short for whole tracks |
| Longest track | 480 s (`MAX_AUDIO_SECONDS`) | Keeps the slowest expected run inside the timeout. The client checks `duration_s` and doesn't call for a longer track. The handler checks again. Either way the result is TK18's failed state, and the operator's drop cuts on seconds |
| Ephemeral storage | 1024 MB | The download plus one 44.1 kHz WAV |
| Reserved concurrency | **2** | The cap. At most 2 analyses at once, account-wide. A third call is throttled, and the client queues the row again |
| Async retries | 0 | The app only calls synchronously. If anything calls it async, there's no second paid run |
| Architecture | arm64 | See The image |
| Env | `AUDIO_URL_HOSTS`, `MAX_AUDIO_SECONDS` | Only `https` URLs on the Supabase project's host (from `NEXT_PUBLIC_SUPABASE_URL`) are fetched |

**Contract.** In: `{"audioUrl": "<signed Storage URL>", "key": "<drive id>@<modified time>"}`. Out: `{"ok": true, "key", "analysis": {"model", "durationS", "beats", "downbeats", "bassBeatDb"}, "timingsS"}`, or `{"ok": false, "key", "kind": "bad_request" | "too_long" | "audio" | "analysis", "error"}`. `bassBeatDb[i]` is the bass stem's RMS from `beats[i]` to `beats[i+1]`, in dB, the last beat running to the end. The signed URL is never logged or returned.

## IAM (least privilege)

- **Execution role** `top-tracks-analysis-role`: Lambda in this account only (`aws:SourceAccount`). The inline policy `top-tracks-analysis-logs` allows `logs:CreateLogStream` and `logs:PutLogEvents` on `/aws/lambda/top-tracks-analysis:*` and nothing else. It has no S3, no Supabase and no secrets: the audio comes through the signed URL. The deploy script makes the log group, with 14-day retention, so the role needs no `CreateLogGroup`.
- **ECR repository** `top-tracks-analysis`: scan on push, immutable tags. The repository policy lets `lambda.amazonaws.com` pull (`BatchGetImage`, `GetDownloadUrlForLayer`) for this function's ARN only.
- **The app's user**: the inline user policy `top-tracks-analysis-invoke` on the IAM user behind `REMOTION_AWS_ACCESS_KEY_ID` allows `lambda:InvokeFunction` on this one function. It sits beside that user's `remotion-render-*` statements, which are left untouched. The app uses the keys it already has; no new secret.
- The deploy runs as an admin profile. The Remotion user can't create roles.

## Alarms and billing

**The existing billing alarms are not changed:** the $20 and the $50 ceiling stay as they are. A CloudWatch `EstimatedCharges` alarm (us-east-1) with no `ServiceName` dimension, or an AWS Budget with no service filter, already counts every service in the account, so it covers this function's Lambda and ECR charges without any change. The deploy script reads the billing alarms (read-only) and prints each one's threshold and scope, so Matas can check that. If it finds none, the $20 and $50 alarms are probably AWS Budgets: check they have no service filter.

**Added beside them**, in eu-west-2. They fire within the hour, where `EstimatedCharges` lags by hours:

| Alarm | Metric | Fires when | What it means |
|---|---|---|---|
| `top-tracks-analysis-compute-hour` | `Duration` Sum, 1 h | over 3,600,000 ms (1 h of function time) in an hour | Normal is a few tracks a day; a fresh act's 10 tracks are about 35 min. The cap allows 2 h an hour, so this means the cap has been mostly busy for an hour: a loop. About $0.19 of compute |
| `top-tracks-analysis-calls-day` | `Invocations` Sum, 1 day | over 150 calls in a day | Normal is tens. 150 calls at the dearest call is about $2.40 |

Both notify the SNS topic `top-tracks-analysis-alarms`, which gets an email subscription (`--alarm-email`; confirm the email AWS sends), or an existing eu-west-2 topic (`--alarm-topic-arn`). Two alarms cost $0.20 a month.

## Cost

At 4 GB arm64 ($0.0000133334 per GB-second, plus $0.0000002 a request):

| | Cost |
|---|---|
| One whole track, 2 min | **$0.0064** |
| One whole track, 5 min | **$0.0160** |
| A fresh act's 10 tracks | about $0.06–0.16 |
| The cap's worst case: both slots busy all day | $9.22 a day. The compute alarm fires in its first hour |
| ECR (3 images) plus 2 alarms | about $0.50 a month |

These are desk estimates from the write-up. The test call prints the billed duration and the cost of a real call.

Measured locally on 18 Nov (Apple M4 Pro, the handler itself through `smoke.py`, not the container): a 124 s synthetic MP3 at 48 kHz took 66.5 s, with 64.2 s of it in the models. The reply was 5.7 KB of JSON. The bass break was read at the bars it was written at. PR #1342 measured Can't Decide (2:55) at 68 s on the same machine.

## Deploy (Matas)

Prerequisites:
- Docker Desktop or OrbStack, with buildx. **Not on this machine on 18 Nov**: `docker` isn't installed, so the image has never been built.
- An admin AWS profile (`AWS_PROFILE`). The AWS CLI isn't needed: the scripts use the AWS SDK.
- `.env.local`, for `NEXT_PUBLIC_SUPABASE_URL` (the audio host) and the Remotion keys (to find the invoke user).

1. Look at the plan. This makes no AWS call and needs no credentials:

   ```bash
   node --env-file=.env.local --experimental-strip-types scripts/top-tracks-analysis-deploy.mts --dry-run
   ```

2. Deploy. It builds and pushes the arm64 image, then creates or updates the role, log group, function, cap, invoke grant and alarms, then reads the billing alarms. A second run changes only what differs. The image is rebuilt from cache, and the function's code is updated only when the digest changes:

   ```bash
   AWS_PROFILE=<admin> node --env-file=.env.local --experimental-strip-types scripts/top-tracks-analysis-deploy.mts --alarm-email <address>
   ```

   `--invoke-user <name>` names the app's IAM user. Without it, the script reads it from the Remotion keys (`sts:GetCallerIdentity`).

3. Confirm the SNS subscription email.

4. Make one test call on Can't Decide's Storage copy. Signing the URL is a read: no row and no Storage object is written. The script prints the timings, Lambda's REPORT line (billed duration, peak memory, init duration) and the cost:

   ```bash
   node --env-file=.env.local --experimental-strip-types scripts/top-tracks-analysis-invoke.mts --storage-path audio/creative-lab/<event id>/<drive id>.mp3 --modified-time <Drive modifiedTime> --out /tmp/cant-decide-analysis.json
   ```

5. Acceptance, on #1342's branch. **Can't Decide's drop must land at 2:07.5 ± 0.5 s.** #1342 stays draft until it does:

   ```bash
   npx tsx scripts/top-tracks-acceptance.mts --analysis-json /tmp/cant-decide-analysis.json --track "Can't Decide=<local copy>@2:07.5±0.5"
   ```

6. On Vercel Preview and Production set `TOP_TRACKS_ANALYSIS_FUNCTION=top-tracks-analysis`. Set `ENABLE_TOP_TRACKS_ANALYSIS=1` only after #1342's wiring (below) is merged.

If the REPORT line shows a whole track running past about 450 s, or peak memory near 4096 MB, raise memory to 6144 MB (more vCPUs, so faster, at about the same cost per call). Lambda's ceiling for the timeout is 900 s. Change `FUNCTION_MEMORY_MB` / `FUNCTION_TIMEOUT_SECONDS` in `lambda-analysis.ts` and run the deploy again.

### Local container check (needs Docker)

The AWS base image includes the runtime interface emulator:

```bash
docker buildx build --platform linux/arm64 --provenance=false --load -t top-tracks-analysis:local infra/top-tracks-analysis
docker run --rm -p 9000:8080 -e AUDIO_URL_HOSTS=<project>.supabase.co top-tracks-analysis:local
curl -s localhost:9000/2015-03-31/functions/function/invocations -d '{"audioUrl":"<signed URL>","key":"<drive id>@<modified time>"}' | head -c 600
docker image rm top-tracks-analysis:local
```

The image is about 2 GB, so remove it afterwards. Without Docker, `smoke.py` runs the same handler on a local file with any Python that has `requirements.txt` and torch 2.5.1:

```bash
TORCH_HOME=<dir with hub/checkpoints> <venv>/bin/python -I infra/top-tracks-analysis/smoke.py <audio file>
```

## Roll back

- **Stop the app calling:** unset `ENABLE_TOP_TRACKS_ANALYSIS` on Vercel. With the flag off, nothing signs a URL or calls AWS. Files read TK18's failed line and the operator's drop cuts on seconds, which is the app's behaviour today.
- **Stop every call at once, from anywhere:** `--pause` sets reserved concurrency to 0. Every call is throttled and costs nothing. Queued rows stay queued. `--resume` puts the cap back:

  ```bash
  AWS_PROFILE=<admin> node --experimental-strip-types scripts/top-tracks-analysis-deploy.mts --pause
  ```

- **Back to an earlier image:** ECR keeps the last 3. `--image-uri <account>.dkr.ecr.eu-west-2.amazonaws.com/top-tracks-analysis@sha256:<digest>` deploys one without building.
- **Remove it all**, in the console, in this order: the alarms `top-tracks-analysis-compute-hour` and `top-tracks-analysis-calls-day`; the SNS topic `top-tracks-analysis-alarms`; the function `top-tracks-analysis`; the log group `/aws/lambda/top-tracks-analysis`; the user policy `top-tracks-analysis-invoke` on the Remotion user; the role `top-tracks-analysis-role`; the ECR repository `top-tracks-analysis`. The billing alarms are not touched.

## Wiring it into #1342 (after both merge)

This PR is based on `main` and doesn't depend on #1342. The store is written against migration 262's columns (`creative_lab_audio_files.analysis`, `analysis_key`, `analysis_state`), which aren't on `main`, so nothing here runs until #1342's wiring calls it. On #1342's branch, after this PR merges:

1. **Queue, don't call inline.** In `readAudioFile` (`lib/creative-tests/audio-intake.ts`), when `deps.studio?.remote` is true, don't call `analyse` after the upload. Return `analysisKey: key`, `analysisState: "running"` and `analysis: queuedAnalysisColumns(key).analysis`, and widen `ReadResult["analysisState"]` to include `"running"`. The row reads "Finding the drops…" and can't be ticked (TK18). A whole track takes 2–5 min, past the scan routes' `maxDuration = 300`. `localStudio` (the scripts) keeps the inline call.
2. **A new file version queues again.** Where the intake sees a known row whose `analysisKey(file.id, file.modifiedTime)` differs from `analysis_key`, write `queuedAnalysisColumns(newKey)`.
3. **The source.** In `lib/creative-tests/snippet-server.ts`'s intake deps, replace `studio: null` with `studio: isTopTracksAnalysisEnabled() ? lambdaStudio({ sign: (p) => signedUrl(db, AUDIO_BUCKET, p) }) : null`.
4. **The worker.** In `app/api/cron/creative-lab-render-tick/route.ts` (`maxDuration = 800`, room for one 600 s call), or a cron of its own on the same `maxDuration`:

   ```ts
   const { runAnalysisTick, supabaseAnalysisStore } = await import("@/lib/creative-tests/top-tracks/lambda-analysis");
   await runAnalysisTick({
     store: supabaseAnalysisStore(supabase),
     client: { sign: (p) => signedUrl(supabase, AUDIO_BUCKET, p) },
     onDone: (a, row) => {
       const tk = snippetDropFrom(a); // audio-intake.ts: TK14's drops, TK15's choice, the stored {v: 2, …, R, drops, grid}
       const lab = row.dropSource !== "operator" && row.durationS ? { drop_s: tk.dropS, drop_source: tk.dropS != null ? "lab" : null, drop_choice: tk.choice, window_start_s: tk.dropS != null ? windowForDrop(tk.dropS, row.durationS, clampLength(null)).startS : null } : {};
       return { analysis: tk.stored, ...lab };
     },
   });
   ```

   It takes at most 2 queued rows a tick, the cap. A throttled call queues its row again. A failure stores `{v: 2, error, kind}` with `analysis_state = 'failed'` (TK18's failed line), and that version isn't retried. A claim whose worker died is taken over after 15 min. A result is written only if the row still holds the same key, so a newer file version that arrives mid-run is never overwritten.
5. Point #1342's `docs/top-tracks-analysis-lambda.md` at this page.

## Env vars

| Name | Where | Default | |
|---|---|---|---|
| `ENABLE_TOP_TRACKS_ANALYSIS` | Vercel | unset (off) | Must be exactly `1` for the app to call the host |
| `TOP_TRACKS_ANALYSIS_FUNCTION` | Vercel | `top-tracks-analysis` | The function name |
| `REMOTION_AWS_ACCESS_KEY_ID` / `REMOTION_AWS_SECRET_ACCESS_KEY` / `REMOTION_AWS_REGION` | Vercel (already set) | — | The invoke credentials, unchanged |
| `AUDIO_URL_HOSTS`, `MAX_AUDIO_SECONDS` | the Lambda (the deploy script sets them) | — | Not Vercel vars |
