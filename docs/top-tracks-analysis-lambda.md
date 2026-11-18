# Top tracks: deploying the studio-track analysis (for Matas to approve)

Issue 2 (`docs/design-record/2026-11-18-creative-lab-top-tracks-2.html`, TK13, TK14, TK18) reads every studio track with two models, the Demucs study's:
- **Beat This!** (`final0`) on the master, for the beats and downbeats.
- **Demucs** (htdemucs), for the bass stem's level per beat.

They run once per file version, keyed by the Drive id and Drive's modified time. **Nothing is deployed, and no AWS or Vercel resource is created.** This page lists exactly what deploying it would take. (The file keeps its first name. Issue 1's bass-stem "fallback" is withdrawn: the stem is now the main method.)

## What's built

| Piece | Where | Runs where |
|---|---|---|
| TK13 grid, TK14 drops, TK15 choice, TK16 hook | `lib/creative-tests/top-tracks/studio.ts`, `audio-rules.ts` | anywhere (pure) |
| The analysis: `StudioSource` interface, TK18's key | `lib/creative-tests/top-tracks/analysis-source.ts` | — |
| `localStudio`: Beat This! + htdemucs through a local Python | `analysis-source.ts`, `scripts/top-tracks/analyse.py` | the operator's machine only (drafts, acceptance and re-pick scripts) |
| Stored with the file (TK18) | `creative_lab_audio_files.analysis`, `analysis_key`, `analysis_state` (migration 262) | — |

In the app the source is **null**:
- **Snippet and Top tracks rows:** every file reads "Couldn't read this track's beat — drag the drop marker to it." An operator's drop cuts on seconds.
- **TK17 replaces CT4's detector,** so merging before a source exists means new snippet-static files get no Lab drop at all, where today they get CT4's single best rise. That's a merge question for Matas.
- **The stem** is never written as audio, rendered, filed or offered: `analyse.py` returns per-beat levels only.

## Measured locally (18 Nov)

- Apple M4 Pro (14 cores), torch 2.5.1 CPU, demucs 4.0.1, htdemucs (`shifts=1`, `overlap=0.25`).
- Can't Decide (2:55, MP3): **75 s wall** (387 s user across the cores).
- Weights: `955717e8-8726e21a.th`, 80.2 MB, sha256 `8726e21a993978c7ba086d3872e7608d7d5bfca646ca4aca459ffda844faa8b4`, from `dl.fbaipublicfiles.com` (Demucs's own URL; it resolved normally, with no IP pinning).
- Beat This! weights: `beat_this-final0.ckpt`, 81.1 MB, sha256 `8c328b45f59d8dd3dff219253ff6a8d6482be57d0133a29140e2febbf8eb8331` (the study's), from `cloud.cp.jku.at`, which resolved normally.
- **One analysis (both models) of Can't Decide: 68 s wall.**
- Output: beats, downbeats and per-beat bass levels, about 10 KB of JSON for a 3-minute track.

**Correction to the study's estimate:** the study's $0.003 and 35–60 s were for 30–50 s phone clips. Top tracks reads whole tracks, 3–5 minutes, so it's 3–5× that:

| | Study (clips) | Top tracks (whole tracks, estimate) |
|---|---|---|
| Audio per call | 30–50 s | 150–300 s |
| Warm run on Lambda (0.7–1.1× real time, the study's Graviton guess) | 35–60 s | **2–5 min** |
| Memory | 4096 MB | 4096 MB (peak RSS about 2.5 GB on a clip; a whole track needs measuring, since Demucs splits into segments) |
| Cost per call, arm64 at $0.0000133334 per GB-s | about $0.003 | **about $0.007–0.016** |

Both columns are desk estimates. One test invoke would replace them.

## What deploying needs (nothing below exists)

1. **A container image in ECR, eu-west-2**: repository `top-tracks-bass-stem`.
   - Base: `public.ecr.aws/lambda/python:3.12` (arm64).
   - Packages: `torch==2.5.1` CPU-only from the PyTorch CPU index, `demucs==4.0.1`, `beat-this==1.1.0`, `soundfile`, `numpy`, and a static `ffmpeg` (or decode in the caller and send WAV).
   - Bake both sets of weights in at the sha256s above, with `TORCH_HOME=/opt/torch` set, so the function never downloads at run time.
   - Handler: `scripts/top-tracks/analyse.py`'s `main` wrapped as `handler(event)`. In: `{ audioUrl }` (a signed Supabase Storage URL for the Lab's copy, the render pattern). Out: the same JSON (`durationS`, `beats`, `downbeats`, `bassBeatDb`).
   - About 1.5 GB with torch, or about 0.4 GB after an ONNX export (htdemucs's STFT makes that export real work, so it's a follow-up).
   - ECR storage is about $0.15 a month.
2. **The function**: `top-tracks-bass-stem`, image package type, arm64.
   - 4096 MB, ephemeral storage 1024 MB, **timeout 600 s** (a 5-minute track at 1.1× real time is 5.5 min; the study's 300 s is too short for whole tracks), reserved concurrency 2.
   - Its own execution role with CloudWatch Logs only. It reads audio through the signed URL, so it needs no S3 or Supabase credentials.
3. **Invoke permission**: `lambda:InvokeFunction` on that one ARN, added to the IAM user whose keys are `REMOTION_AWS_ACCESS_KEY_ID` / `REMOTION_AWS_SECRET_ACCESS_KEY`. It goes beside its `remotion-render-*` statement. Keep the billing alarm as it is.
4. **One Vercel env var**, Preview and Production: `TOP_TRACKS_BASS_STEM_FUNCTION=top-tracks-bass-stem`. Unset means no stem source (today's behaviour).
5. **App code (a follow-up PR, small)**: a `lambdaStudio()` `StudioSource` that signs the Storage URL and invokes with `@aws-sdk/client-lambda` (already a Remotion dependency).
   - It goes where `snippet-server.ts` passes `studio: null`.
   - TK18's "Finding the drops…" state needs the intake to write `analysis_state = 'running'` before the invoke and `done` or `failed` after.
   - It runs when a file is first offered or its modified time changes, never in the render path, so a cold start (6–15 s plus the image pull) never blocks a render.

## Can it be exercised without the Lambda?

Locally, yes: `scripts/top-tracks-acceptance.mts --python <venv>/bin/python`, `scripts/top-tracks-drafts.mts --python …` and `scripts/snippet-drop-repick.mts --python …`.

In the app, no: TK13–TK18 can't run until steps 1–5 exist.
