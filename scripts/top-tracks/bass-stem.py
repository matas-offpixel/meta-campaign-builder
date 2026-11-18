"""
TK3's bass-stem fallback, the stem half (docs/top-tracks-bass-stem-lambda.md).

    python -I scripts/top-tracks/bass-stem.py <input.wav> <out.json>

Separates the track with Demucs (htdemucs, as in the 18 Nov study) and writes
the bass and drums stems' levels per 50 ms, in dB, as JSON:

    {"frameS": 0.05, "bassDb": [...], "drumsDb": [...], "model": "htdemucs"}

The input is a WAV the caller decoded with ffmpeg (44.1 kHz). Nothing is
fetched except Demucs's own weights on first run (into TORCH_HOME). Local
only: the app never runs this; the Lambda it would need doesn't exist.
"""

import json
import sys

import numpy as np
import soundfile as sf
import torch
from demucs.apply import apply_model
from demucs.pretrained import get_model

FRAME_S = 0.05
FLOOR_DB = -90.0


def levels_db(mono: np.ndarray, rate: int) -> list:
    per = int(round(FRAME_S * rate))
    frames = len(mono) // per
    out = []
    for i in range(frames):
        seg = mono[i * per:(i + 1) * per]
        rms = float(np.sqrt(np.mean(seg * seg))) if len(seg) else 0.0
        out.append(round(max(FLOOR_DB, 20 * np.log10(rms)) if rms > 0 else FLOOR_DB, 2))
    return out


def main(src: str, dst: str) -> None:
    torch.set_num_threads(max(1, torch.get_num_threads()))
    audio, rate = sf.read(src, dtype="float32", always_2d=True)
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
    names = model.sources
    bass = sources[names.index("bass")].mean(0).numpy()
    drums = sources[names.index("drums")].mean(0).numpy()
    with open(dst, "w") as fh:
        json.dump({"frameS": FRAME_S, "bassDb": levels_db(bass, rate), "drumsDb": levels_db(drums, rate), "model": "htdemucs"}, fh)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: bass-stem.py <input.wav> <out.json>")
    main(sys.argv[1], sys.argv[2])
