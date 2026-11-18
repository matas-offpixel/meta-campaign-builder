"""
Smoke test of the handler outside Lambda: the full path (validate, "download",
decode + resample, both models, the JSON) on a local audio file. Only the
HTTP fetch is replaced by a file copy.

    TORCH_HOME=<dir with hub/checkpoints/{955717e8-8726e21a.th,beat_this-final0.ckpt}> \
      <python with requirements.txt + torch 2.5.1> -I infra/top-tracks-analysis/smoke.py <audio file> [<out.json>]

With the container built, the same check runs against the Lambda runtime
emulator (docs/TOP_TRACKS_ANALYSIS_LAMBDA_SETUP.md, "Local container check").
"""

import json
import os
import shutil
import sys
import time

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(ROOT, "app"))

import handler  # noqa: E402


def main() -> None:
    if len(sys.argv) not in (2, 3):
        raise SystemExit("usage: smoke.py <audio file> [<out.json>]")
    src = os.path.abspath(sys.argv[1])
    os.environ["AUDIO_URL_HOSTS"] = "smoke.invalid"
    handler.download = lambda _url, dest, _allowed, **_k: shutil.copyfile(src, dest) and os.path.getsize(dest)
    t = time.monotonic()
    out = handler.handler({"audioUrl": "https://smoke.invalid/audio", "key": "smoke-test-file-id@2026-11-18T00:00:00.000Z"})
    wall = time.monotonic() - t
    raw = json.dumps(out)
    if len(sys.argv) == 3:
        with open(sys.argv[2], "w") as fh:
            fh.write(raw)
    if not out["ok"]:
        raise SystemExit(f"handler failed: {out['kind']}: {out['error']}")
    a = out["analysis"]
    assert len(a["beats"]) == len(a["bassBeatDb"]) and a["downbeats"], "shape"
    print(json.dumps({"wallS": round(wall, 1), "jsonBytes": len(raw), "durationS": round(a["durationS"], 2), "beats": len(a["beats"]), "downbeats": len(a["downbeats"]), "timingsS": out["timingsS"]}))


if __name__ == "__main__":
    main()
