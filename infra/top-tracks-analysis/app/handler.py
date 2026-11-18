"""
Lambda entry point for the Top tracks analysis host (TK13, TK14, TK18).

Event (synchronous invoke from the app, lib/creative-tests/top-tracks/lambda-analysis.ts):

    {"audioUrl": "https://<project>.supabase.co/storage/v1/object/sign/...",
     "key": "<drive_file_id>@<Drive modifiedTime>"}

Returns about 10 KB of JSON and never the stem's audio:

    {"ok": true, "key": ..., "analysis": {"model", "durationS", "beats",
     "downbeats", "bassBeatDb"}, "timingsS": {...}}

or, for anything the function itself can tell is wrong,

    {"ok": false, "key": ..., "kind": "bad_request" | "too_long" | "audio" | "analysis",
     "error": "<short message>"}

The function holds no Supabase or S3 credentials: it reads the audio through
the signed URL the app gives it. The URL is never logged or returned (it
carries a token). Only https URLs on AUDIO_URL_HOSTS are fetched.
"""

import json
import os
import re
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

TORCH_HOME = os.environ.get("TORCH_HOME", "/opt/torch")
WEIGHTS_DIR = os.path.join(TORCH_HOME, "hub", "checkpoints")
HTDEMUCS_FILE = "955717e8-8726e21a.th"
FINAL0_FILE = "beat_this-final0.ckpt"

KEY_RE = re.compile(r"^[A-Za-z0-9_-]{10,200}@[A-Za-z0-9:.+_-]{1,64}$")
MAX_DOWNLOAD_BYTES = int(os.environ.get("MAX_DOWNLOAD_BYTES", str(400 * 1024 * 1024)))
MAX_AUDIO_SECONDS = float(os.environ.get("MAX_AUDIO_SECONDS", "480"))
DOWNLOAD_TIMEOUT_S = 60
TARGET_RATE = 44100

_models = None


class Refusal(Exception):
    """A handled failure, returned as {ok: false, kind, error}."""

    def __init__(self, kind: str, message: str):
        super().__init__(message)
        self.kind = kind


def allowed_hosts() -> list[str]:
    raw = os.environ.get("AUDIO_URL_HOSTS", "")
    return [h.strip().lower() for h in raw.split(",") if h.strip()]


def host_allowed(host: str | None, allowed: list[str]) -> bool:
    """An entry is an exact host ("abc.supabase.co") or a suffix starting with a dot (".supabase.co")."""
    if not host:
        return False
    host = host.lower()
    for entry in allowed:
        if entry.startswith("."):
            if host.endswith(entry) and len(host) > len(entry):
                return True
        elif host == entry:
            return True
    return False


def validate_event(event, allowed: list[str]) -> tuple[str, str]:
    if not isinstance(event, dict):
        raise Refusal("bad_request", "event is not an object")
    key = event.get("key")
    if not isinstance(key, str) or not KEY_RE.match(key):
        raise Refusal("bad_request", "key must be <drive_file_id>@<modified time>")
    url = event.get("audioUrl")
    if not isinstance(url, str) or len(url) > 4096:
        raise Refusal("bad_request", "audioUrl is missing")
    parts = urllib.parse.urlsplit(url)
    if parts.scheme != "https":
        raise Refusal("bad_request", "audioUrl must be https")
    if parts.username or parts.password or parts.port not in (None, 443):
        raise Refusal("bad_request", "audioUrl must be a plain https URL")
    if not allowed:
        raise Refusal("bad_request", "AUDIO_URL_HOSTS is not set on the function")
    if not host_allowed(parts.hostname, allowed):
        raise Refusal("bad_request", "audioUrl host is not allowed")
    return url, key


class _SameHostRedirect(urllib.request.HTTPRedirectHandler):
    def __init__(self, allowed: list[str]):
        self.allowed = allowed

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        parts = urllib.parse.urlsplit(newurl)
        if parts.scheme != "https" or not host_allowed(parts.hostname, self.allowed):
            raise Refusal("audio", "the audio URL redirected off the allowed hosts")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def download(url: str, dest: str, allowed: list[str], max_bytes: int = MAX_DOWNLOAD_BYTES) -> int:
    opener = urllib.request.build_opener(_SameHostRedirect(allowed))
    size = 0
    try:
        with opener.open(url, timeout=DOWNLOAD_TIMEOUT_S) as resp, open(dest, "wb") as out:
            if resp.status != 200:
                raise Refusal("audio", f"the audio URL answered {resp.status}")
            while True:
                chunk = resp.read(1 << 20)
                if not chunk:
                    break
                size += len(chunk)
                if size > max_bytes:
                    raise Refusal("audio", f"the audio file is over {max_bytes // (1024 * 1024)} MB")
                out.write(chunk)
    except urllib.error.HTTPError as err:
        # Never echo the URL: it carries the signing token.
        raise Refusal("audio", f"the audio URL answered {err.code}") from None
    except urllib.error.URLError as err:
        raise Refusal("audio", f"the audio URL could not be read ({type(err.reason).__name__})") from None
    if size == 0:
        raise Refusal("audio", "the audio file is empty")
    return size


def to_master_wav(src: str, dst: str, max_seconds: float = MAX_AUDIO_SECONDS) -> float:
    """
    What the local path does with ffmpeg (`-ar 44100 -ac 2`, 16-bit WAV), with
    libsndfile and soxr: WAV, AIFF, FLAC and MP3 (AU1's formats) all read.
    Returns the duration in seconds.
    """
    import numpy as np
    import soundfile as sf
    import soxr

    try:
        info = sf.info(src)
    except Exception:
        raise Refusal("audio", "the audio file could not be decoded") from None
    if info.duration > max_seconds:
        raise Refusal("too_long", f"the track is {info.duration:.0f} s; the host reads up to {max_seconds:.0f} s")
    data, rate = sf.read(src, dtype="float32", always_2d=True)
    if data.shape[0] == 0:
        raise Refusal("audio", "the audio file has no samples")
    if data.shape[1] == 1:
        data = np.repeat(data, 2, axis=1)
    elif data.shape[1] > 2:
        data = data[:, :2]
    if rate != TARGET_RATE:
        data = soxr.resample(data, rate, TARGET_RATE, quality="HQ")
    sf.write(dst, data, TARGET_RATE, subtype="PCM_16")
    return data.shape[0] / TARGET_RATE


def check_weights(weights_dir: str = WEIGHTS_DIR) -> str:
    """Both weight files are baked into the image; nothing is downloaded at run time."""
    for name in (HTDEMUCS_FILE, FINAL0_FILE):
        if not os.path.isfile(os.path.join(weights_dir, name)):
            raise RuntimeError(f"weights missing from the image: {name}")
    return os.path.join(weights_dir, FINAL0_FILE)


def models():
    global _models
    if _models is None:
        from analysis import load_models

        _models = load_models(check_weights())
    return _models


def log(**fields) -> None:
    print(json.dumps({"tt": "top-tracks-analysis", **fields}))


def handler(event, context=None):
    started = time.monotonic()
    key = event.get("key") if isinstance(event, dict) and isinstance(event.get("key"), str) else None
    timings = {}
    try:
        url, key = validate_event(event, allowed_hosts())
        with tempfile.TemporaryDirectory(dir="/tmp" if os.path.isdir("/tmp") else None) as work:
            src = os.path.join(work, "source")
            t = time.monotonic()
            size = download(url, src, allowed_hosts())
            timings["downloadS"] = round(time.monotonic() - t, 2)
            t = time.monotonic()
            master = os.path.join(work, "master.wav")
            to_master_wav(src, master)
            os.remove(src)
            timings["decodeS"] = round(time.monotonic() - t, 2)
            t = time.monotonic()
            f2b, demucs = models()
            timings["loadS"] = round(time.monotonic() - t, 2)
            t = time.monotonic()
            from analysis import analyse_wav

            result = analyse_wav(master, f2b, demucs)
            timings["analyseS"] = round(time.monotonic() - t, 2)
        timings["totalS"] = round(time.monotonic() - started, 2)
        log(key=key, ok=True, bytes=size, durationS=round(result["durationS"], 2), beats=len(result["beats"]), **timings)
        return {"ok": True, "key": key, "analysis": result, "timingsS": timings}
    except Refusal as err:
        log(key=key, ok=False, kind=err.kind, error=str(err))
        return {"ok": False, "key": key, "kind": err.kind, "error": str(err)[:300]}
    except Exception as err:  # noqa: BLE001 - the app stores TK18's failed state either way
        message = f"{type(err).__name__}: {err}"[:300]
        log(key=key, ok=False, kind="analysis", error=message)
        return {"ok": False, "key": key, "kind": "analysis", "error": message}
