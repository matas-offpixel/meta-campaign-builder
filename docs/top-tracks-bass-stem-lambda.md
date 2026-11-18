# Top tracks: deploying the bass-stem fallback (for Matas to approve)

TK3 (`docs/design-record/2026-11-18-creative-lab-top-tracks.html`) falls back to a Demucs-separated bass ranking when VW14 finds no qualifying drop. This PR builds that fallback behind an interface. **Nothing is deployed, and no AWS or Vercel resource is created.** This page lists exactly what deploying it would take.

## What's built

| Piece | Where | Runs where |
|---|---|---|
| Detector candidates (every CT4 rise ≥ 6 dB past 20 s, merged within 1 s) | `lib/creative-tests/top-tracks/bass-stem.ts` `detectorCandidates` | anywhere (pure) |
| The study's compact ranking on the stems (bass jump, stop8, sustain8, collapse8, kicks after) | `bass-stem.ts` `rankOnBassStem`, `bassStemTop2` | anywhere (pure) |
| TK3's choice on the top 2 (the later that qualifies, last third first, " · found on the bass stem") | `audio-rules.ts` `chooseDrop` | anywhere (pure) |
| The stems: `StemSource` interface | `bass-stem.ts` | — |
| `localDemucs`: htdemucs through a local Python | `bass-stem.ts`, `scripts/top-tracks/bass-stem.py` | the operator's machine only (drafts and acceptance scripts) |

In the app the stem source is **null**. A track VW14 misses reads "{title}: no drop found — drag the drop marker to it." The snippet static's intake is the same (`audio-intake.ts`).

## Measured locally (18 Nov)

- Apple M4 Pro (14 cores), torch 2.5.1 CPU, demucs 4.0.1, htdemucs (`shifts=1`, `overlap=0.25`).
- Can't Decide (2:55, MP3): **75 s wall** (387 s user across the cores).
- Weights: `955717e8-8726e21a.th`, 80.2 MB, sha256 `8726e21a993978c7ba086d3872e7608d7d5bfca646ca4aca459ffda844faa8b4`, from `dl.fbaipublicfiles.com` (Demucs's own URL; it resolved normally, with no IP pinning).
- Output: 50 ms bass and drums levels, about 54 KB of JSON for a 3-minute track.

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
   - Packages: `torch==2.5.1` CPU-only from the PyTorch CPU index, `demucs==4.0.1`, `soundfile`, `numpy`, and a static `ffmpeg` (or decode in the caller and send WAV).
   - Bake the htdemucs weights in at the sha256 above, with `TORCH_HOME=/opt/torch` set, so the function never downloads at run time.
   - Handler: `scripts/top-tracks/bass-stem.py`'s `main` wrapped as `handler(event)`. In: `{ audioUrl }` (a signed Supabase Storage URL for the Lab's copy, the render pattern). Out: the same JSON (`frameS`, `bassDb`, `drumsDb`).
   - About 1.5 GB with torch, or about 0.4 GB after an ONNX export (htdemucs's STFT makes that export real work, so it's a follow-up).
   - ECR storage is about $0.15 a month.
2. **The function**: `top-tracks-bass-stem`, image package type, arm64.
   - 4096 MB, ephemeral storage 1024 MB, **timeout 600 s** (a 5-minute track at 1.1× real time is 5.5 min; the study's 300 s is too short for whole tracks), reserved concurrency 2.
   - Its own execution role with CloudWatch Logs only. It reads audio through the signed URL, so it needs no S3 or Supabase credentials.
3. **Invoke permission**: `lambda:InvokeFunction` on that one ARN, added to the IAM user whose keys are `REMOTION_AWS_ACCESS_KEY_ID` / `REMOTION_AWS_SECRET_ACCESS_KEY`. It goes beside its `remotion-render-*` statement. Keep the billing alarm as it is.
4. **One Vercel env var**, Preview and Production: `TOP_TRACKS_BASS_STEM_FUNCTION=top-tracks-bass-stem`. Unset means no stem source (today's behaviour).
5. **App code (a follow-up PR, small)**: a `lambdaStems()` `StemSource` that signs the Storage URL and invokes with `@aws-sdk/client-lambda` (already a Remotion dependency), wired where `audio-intake.ts` and the Top tracks render read drops. It runs when a file is read or re-read, never in the render path, so a cold start (6–15 s plus the image pull) never blocks a render.

## Can it be exercised without the Lambda?

Locally, yes: `scripts/top-tracks-acceptance.mts --bass-stem <venv>/bin/python` and `scripts/top-tracks-drafts.mts --bass-stem …`.
- On Can't Decide the ranking puts **2:07.50 first** (score 4.38, bass jump +50.1 dB), exactly Matas's time.
- TK3's rule "the later of the top 2" then picks 2:34.95. That's the design question in the PR.

In the app, no: the fallback can't run until steps 1–5 exist.
