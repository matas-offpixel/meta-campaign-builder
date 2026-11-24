"""
Top tracks issue 2 (docs/design-record/2026-11-18-creative-lab-top-tracks-2.html,
TK13, TK14, TK18): one analysis pass over a studio track's master.

This is scripts/top-tracks/analyse.py's `main` (PR #1342) as a function, so
the Lambda and the local scripts give the same numbers. Keep the two in step:
the steps, the Demucs settings (shifts=1, split=True, overlap=0.25) and the
-120 dB floor are copied as they are. The only differences are that the
models are loaded once per container (load_models) and the result is returned
instead of written to a file.

- Beat This! (final0) on the full mixed master: the beats and downbeats (TK13).
- Demucs (htdemucs) separates the bass stem; its level is read per beat, as
  the RMS from one beat to the next, in dB (TK14). bassBeatDb[i] is the level
  from beats[i] to beats[i + 1]; the last beat runs to the end of the file.

The stem is data only: it is never written to disk as audio (TK18).
"""

import numpy as np
import soundfile as sf
import torch

FLOOR_DB = -120.0
MODEL = {"beats": "beat_this final0", "stems": "htdemucs"}


def load_models(final0_checkpoint: str):
    """Both models, from the weights baked into the image (no download)."""
    from beat_this.inference import File2Beats
    from demucs.pretrained import get_model

    f2b = File2Beats(checkpoint_path=final0_checkpoint, device="cpu", dbn=False)
    demucs = get_model("htdemucs")
    demucs.eval()
    return f2b, demucs


def analyse_wav(src: str, f2b, model) -> dict:
    """analyse.py's main on a 44.1 kHz WAV: beats, downbeats and per-beat bass levels."""
    from demucs.apply import apply_model

    audio, rate = sf.read(src, dtype="float32", always_2d=True)
    duration = audio.shape[0] / rate

    beats, downbeats = f2b(src)
    beats = [float(b) for b in beats]
    downbeats = [float(d) for d in downbeats]

    if rate != model.samplerate:
        raise ValueError(f"want {model.samplerate} Hz, got {rate}")
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

    return {"model": dict(MODEL), "durationS": duration, "beats": beats, "downbeats": downbeats, "bassBeatDb": levels}
