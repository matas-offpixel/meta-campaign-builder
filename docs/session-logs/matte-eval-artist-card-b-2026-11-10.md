# Matte evaluation for artist-card variant B (measure only; nothing filed)

Branch cc/matte-eval (the evaluation was run on cc/artist-card-prototype's code, merged as #1147). Every card is a 9:16 B render here, rendered with `measureOnly` (the 1:1 face-centre rule is skipped so 17 45 16 and 17 48 32 (1) can be measured; those two stay blocked by that rule whatever the matte). Same renderer, rules, ground choice and unify for every matte. Runtime: onnxruntime-node 1.20.1 (CPU), installed in a scratch folder, not in package.json. No paid API; nothing left the machine except the model downloads from Hugging Face.

The 9:16 renders, the four-way sheet per photo, results.json and the harness (`harness.mts`, run outside the repo because onnxruntime-node is not a dependency) are in the ops notes folder under `artist-cards-P26-BDAY-2026-11-09/matte-eval/`.

## Models and licences (checked in the upstream licence files)
| matte | weights | size | licence | source |
|---|---|---|---|---|
| selfie (production) | MediaPipe Selfie, vendored | 0.3 MB | Apache-2.0 | lib/creative-lab/models/selfie (+ guided filter r 8 at source in the renderer) |
| modnet | MODNet photographic portrait matting | 25.9 MB | Apache-2.0 (ZHKKKe/MODNet LICENSE; README: code, models and demos) | Xenova/modnet onnx/model.onnx, sha256 07c308cf0fc7e6e8b2065a12ed7fc07e1de8febb7dc7839d7b7f15dd66584df9 |
| birefnet-lite | BiRefNet_lite | 224.0 MB | MIT (ZhengPeng7/BiRefNet LICENSE) | onnx-community/BiRefNet_lite-ONNX onnx/model.onnx, sha256 5600024376f572a557870a5eb0afb1e5961636bef4e1e22132025467d0f03333 |
| trimap-cf | Selfie + closed-form matting (Levin et al. 2008; 3×3, ε 1e-7, PCG) | no new weights | — | trimap: in 0.15, out 0.035 face widths from the Selfie edge, ≤ 1200 px working size |
| birefnet-cf | BiRefNet_lite + closed-form matting | 224.0 MB | MIT | trimap: in 0.06, out 0.03 face widths from the BiRefNet edge |

Full BiRefNet (973 MB fp32) not tried: the lite variant already runs at about 4 s per photo on CPU. RMBG and anything GPL or non-commercial were not considered. BiRefNet's training datasets carry their own terms; only the model licence was checked.

## Per photo × matte
Spill max 2 %, halo max 2 %, face alpha min 99 %. Hair edge = mean 10–90 % width of the matte's own alpha at output size, above the chin, within 12 px of the edge (lower is tighter). Matte time = the matte alone (Selfie's own time included in trimap-cf).

| photo | matte | spill | halo | face α ≥ 0.9 | hair edge (px) | matte time | all B rules |
|---|---|---|---|---|---|---|---|
| reeshy-17-37-02 | selfie | 6.00 % | 13.52 % | 100.00 % | 10.16 | 0.7 s | fail: spill, halo |
| reeshy-17-37-02 | modnet | 5.63 % | 9.26 % | 100.00 % | 12.76 | 0.3 s | fail: spill, halo |
| reeshy-17-37-02 | birefnet-lite | 5.37 % | 9.93 % | 100.00 % | 9.46 | 4.1 s | fail: spill, halo |
| reeshy-17-37-02 | trimap-cf | 1.13 % | 13.86 % | 99.79 % | 15.46 | 3.5 s | fail: halo |
| reeshy-17-37-02 | birefnet-cf | 1.59 % | 11.72 % | 100.00 % | 9.61 | 4.9 s | fail: halo |
| reeshy-17-45-16 | selfie | 1.54 % | 3.21 % | 100.00 % | 12.13 | 0.7 s | fail: halo |
| reeshy-17-45-16 | modnet | 0.51 % | 3.45 % | 100.00 % | 10.82 | 0.2 s | fail: halo |
| reeshy-17-45-16 | birefnet-lite | 0.38 % | 0.00 % | 100.00 % | 6.97 | 3.6 s | PASS |
| reeshy-17-45-16 | trimap-cf | 0.87 % | 0.00 % | 99.42 % | 17.36 | 6.9 s | PASS |
| reeshy-17-45-16 | birefnet-cf | 0.00 % | 0.00 % | 100.00 % | 9.21 | 5.3 s | PASS |
| reeshy-17-48-32-1 | selfie | 10.85 % | 22.13 % | 99.99 % | 13.31 | 3.6 s | fail: spill, halo |
| reeshy-17-48-32-1 | modnet | 8.25 % | 12.81 % | 99.91 % | 17.34 | 2.5 s | fail: spill, halo |
| reeshy-17-48-32-1 | birefnet-lite | 15.38 % | 7.61 % | 99.94 % | 6.35 | 5.3 s | fail: spill, halo |
| reeshy-17-48-32-1 | trimap-cf | 15.67 % | 11.57 % | 99.58 % | 15.42 | 11.2 s | fail: spill, halo |
| reeshy-17-48-32-1 | birefnet-cf | 6.39 % | 9.63 % | 99.77 % | 8.00 | 11.7 s | fail: spill, halo |
| reeshy-16-29-53 | selfie | 6.66 % | 12.25 % | 99.68 % | 17.42 | 2.0 s | fail: spill, halo |
| reeshy-16-29-53 | modnet | 8.41 % | 14.30 % | 99.91 % | 16.93 | 1.3 s | fail: spill, halo |
| reeshy-16-29-53 | birefnet-lite | 11.74 % | 8.03 % | 99.96 % | 4.36 | 4.1 s | fail: spill, halo |
| reeshy-16-29-53 | trimap-cf | 2.51 % | 11.34 % | 98.39 % | 17.38 | 14.6 s | fail: faceAlpha, spill, halo |
| reeshy-16-29-53 | birefnet-cf | 3.42 % | 11.11 % | 99.82 % | 9.11 | 7.8 s | fail: spill, halo |
| reeshy-18-44-46 | selfie | 5.64 % | 0.03 % | 97.13 % | 26.39 | 3.8 s | fail: faceAlpha, spill |
| reeshy-18-44-46 | modnet | 7.24 % | 0.78 % | 97.01 % | 15.72 | 2.8 s | fail: faceAlpha, spill |
| reeshy-18-44-46 | birefnet-lite | 8.29 % | 0.03 % | 97.53 % | 4.30 | 5.7 s | fail: faceAlpha, spill |
| reeshy-18-44-46 | trimap-cf | 0.00 % | 0.00 % | 95.14 % | 14.57 | 10.5 s | fail: faceAlpha |
| reeshy-18-44-46 | birefnet-cf | 5.63 % | 0.00 % | 96.48 % | 9.71 | 11.8 s | fail: faceAlpha, spill |
| enzo-11-copy-2 | selfie | 12.00 % | 0.02 % | 99.15 % | 25.38 | 1.8 s | fail: spill |
| enzo-11-copy-2 | modnet | 4.76 % | 0.05 % | 99.09 % | 11.13 | 0.9 s | fail: spill |
| enzo-11-copy-2 | birefnet-lite | 12.14 % | 0.04 % | 99.91 % | 2.83 | 3.7 s | fail: spill |
| enzo-11-copy-2 | trimap-cf | 2.33 % | 0.00 % | 96.95 % | 10.90 | 14.1 s | fail: faceAlpha, spill |
| enzo-11-copy-2 | birefnet-cf | 5.01 % | 0.00 % | 99.60 % | 5.84 | 7.8 s | fail: spill |

## Summary
| matte | passes every B rule | spill ≤ 2 % | halo ≤ 2 % | face α ok | median spill | median halo | median hair edge | median time |
|---|---|---|---|---|---|---|---|---|
| selfie | 0/6 | 1/6 | 2/6 | 5/6 | 6.33 % | 7.73 % | 15.4 px | 1.9 s |
| modnet | 0/6 | 1/6 | 2/6 | 5/6 | 6.43 % | 6.35 % | 14.2 px | 1.1 s |
| birefnet-lite | 1/6 | 1/6 | 3/6 | 5/6 | 10.02 % | 3.82 % | 5.4 px | 4.1 s |
| trimap-cf | 1/6 | 3/6 | 3/6 | 3/6 | 1.73 % | 5.67 % | 15.4 px | 10.9 s |
| birefnet-cf | 1/6 | 2/6 | 3/6 | 5/6 | 4.22 % | 4.81 % | 9.2 px | 7.8 s |

## Recommendation: BiRefNet_lite + closed-form refinement (birefnet-cf)
- BiRefNet_lite gives the cleanest silhouette by eye on all six: no bokeh band beside Reeshy's hair, tight hair (5.4 px median edge vs Selfie's 15.4), and it drops most of Enzo's red double-exposure ghost. Its spill is high (median 10.02 %) because it keeps the photo's own soft hair-into-bokeh mixture at alpha near 1.
- A narrow closed-form pass on its trimap removes most of that (spill 17 37 02 5.37 → 1.59 %, 16 29 53 11.74 → 3.42 %, 17 48 32 (1) 15.38 → 6.39 %, Enzo 12.14 → 5.01 %) and keeps the face box solid (5/6 ≥ 99 %).
- trimap-cf on Selfie has the lowest spill but eats into faces (face alpha 95.14–98.39 % on three photos, inner minimum 0.71 on Enzo) and leaves a pale halo on the hair by eye.
- MODNet is no better than Selfie on these photos and leaves a green fringe at the crown of 17 37 02.

No matte gets these six photos through on its own. Remaining failures are mostly in the photos:
- 17 37 02: a pale rim about 3 px wide at the right of the hair — the photo's defocused hair over bokeh (halo 11.72 %).
- 17 48 32 (1): the orange foreground haze over her body reads as background colour inside the edge (spill 6.39 %).
- 18 44 46: the motion-blurred hand in front of the face box (face alpha 96.48 % with every matte).
- Enzo 11 copy (2): the ghost copy overlaps his face (spill 5.01 %).

Not changed: the production path still uses Selfie. Wiring birefnet-cf would add onnxruntime-node (about 60 MB of native binaries) and a 224 MB model to the repo or a download step — a decision for Matas.
