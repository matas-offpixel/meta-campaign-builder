# Person segmentation model (vendored)

Used by `lib/creative-lab/segment.ts` for the artist card's person mask (O20 amended, O21).

| file | bytes | sha256 |
|---|---|---|
| `selfie.json` | 83,670 | `8b7f5f95c0159a83a7240b1298a67012cfffd0396bfa653bdf452913610e9a88` |
| `selfie.bin` | 212,886 | `8f57aaa72dc068a50bd37c232d2e073e107912241e459002e1480876676f382a` |

- **Model:** MediaPipe Selfie Segmentation, general model, 256×256 RGB in (0–1), 256×256 person mask out. Google, Apache-2.0.
- **Conversion:** TF.js graph model by PINTO0309's model zoo (`109_Selfie_Segmentation`), as recorded in the file's `generatedBy`.
- **Copied from:** npm `@vladmandic/human-models@3.0.4` (MIT), `models/selfie.json` and `models/selfie.bin`, byte for byte. Only these two files are vendored: that package declares its own tooling (eslint, `@google-cloud/storage`) as runtime dependencies, so installing it would add 66 packages for 300 KB of weights.
- **Runtime:** the tfjs bundled in `@vladmandic/face-api` 1.7.15 (CPU backend, pure JS). No network.
- **Not used:** that package's `rvm.json` (Robust Video Matting) would give finer hair edges, but the upstream RVM project is GPL-3.0, so it is not vendored here.

For comparison, face-api's own weights (from `node_modules/@vladmandic/face-api/model/`):

| file | sha256 |
|---|---|
| `ssd_mobilenetv1_model.bin` | `2835640602d53718aa6ae9a42896327eaa21beefed056c218d32ca7d79e1e2f8` |
| `face_landmark_68_model.bin` | `4611ef65c87d836d03d684b30eec4d195d8b219fa1dd58fc58945831c6b9299b` |
