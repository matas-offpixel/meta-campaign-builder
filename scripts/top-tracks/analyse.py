"""
Top tracks issue 2 (docs/design-record/2026-11-18-creative-lab-top-tracks-2.html,
TK13, TK14, TK18): one analysis pass over a studio track.

    python -I scripts/top-tracks/analyse.py <master.wav> <out.json>

- Beat This! (final0, the Demucs study's model) on the full mixed master:
  the beats and the downbeats (TK13).
- Demucs (htdemucs, the study's model) separates the bass stem; its level
  is read per beat, as the RMS from one beat to the next, in dB (TK14).

Writes {"model": {...}, "durationS", "beats": [...], "downbeats": [...],
"bassBeatDb": [...]}. bassBeatDb[i] is the level from beats[i] to
beats[i + 1] (the last beat runs to the end of the file). The stem is data
only: it is never written to disk as audio (TK18).

Weights download on first run into TORCH_HOME (Demucs from
dl.fbaipublicfiles.com, Beat This! from cloud.cp.jku.at), by name, never by
IP. Local only: the app never runs this; the Lambda it would need doesn't
exist (docs/top-tracks-analysis-lambda.md).
"""

import json
import sys

import numpy as np
import soundfile as sf
import torch
from beat_this.inference import File2Beats
from demucs.apply import apply_model
from demucs.pretrained import get_model

FLOOR_DB = -120.0


def main(src: str, dst: str) -> None:
    audio, rate = sf.read(src, dtype="float32", always_2d=True)
    duration = audio.shape[0] / rate

    f2b = File2Beats(checkpoint_path="final0", device="cpu", dbn=False)
    beats, downbeats = f2b(src)
    beats = [float(b) for b in beats]
    downbeats = [float(d) for d in downbeats]

    model = get_model("htdemucs")
    model.eval()
    if rate != model.samplerate:
        raise SystemExit(f"want {model.samplerate} Hz, got {rate}")
    wav = torch.from_numpy(audio.T.copy())
    if wav.shape[0] == 1:
        wav = wav.repeat(2, 1)
    ref = wav.mean(0)
    wav = (wav - ref.mean()) / (ref.std() + 1e-8)
    with torch.no_grad():
        sources = apply_model(model, wav[None], device="cpu", shifts=1, split=True, overlap=0.25, progress=False)[0]
    sources = sources * (ref.std() + 1e-8) + ref.mean()
    bass = sources[model.sources.index("bass")].mean(0).numpy()

    levels = []
    for i, b in enumerate(beats):
        a = int(round(b * rate))
        z = int(round((beats[i + 1] if i + 1 < len(beats) else duration) * rate))
        seg = bass[a:max(a + 1, z)]
        rms = float(np.sqrt(np.mean(seg * seg))) if len(seg) else 0.0
        levels.append(round(max(FLOOR_DB, 20 * np.log10(rms)) if rms > 0 else FLOOR_DB, 2))

    with open(dst, "w") as fh:
        json.dump({"model": {"beats": "beat_this final0", "stems": "htdemucs"}, "durationS": duration, "beats": beats, "downbeats": downbeats, "bassBeatDb": levels}, fh)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: analyse.py <master.wav> <out.json>")
    main(sys.argv[1], sys.argv[2])
