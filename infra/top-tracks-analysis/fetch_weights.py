"""
Build-time only (Dockerfile, `weights` stage): download the two models'
weights from their official hosts and check each sha256. Any mismatch, a
redirect off the approved host, or a short read fails the build.

    python3 -I fetch_weights.py <dest dir>

The files land under the names torch.hub expects in $TORCH_HOME/hub/checkpoints,
so neither library downloads anything when the function runs. The handler
also refuses to start if either file is missing (handler.py, check_weights).

Hosts are reached by name, never by IP. The pins are the ones measured in
docs/top-tracks-analysis-lambda.md (PR #1342):
  htdemucs   955717e8-8726e21a.th    dl.fbaipublicfiles.com (Demucs's own ROOT_URL)
  final0     beat_this-final0.ckpt   cloud.cp.jku.at (beat_this.inference.CHECKPOINT_URL)
"""

import hashlib
import os
import sys
import urllib.parse
import urllib.request

WEIGHTS = [
    {
        "name": "955717e8-8726e21a.th",
        "url": "https://dl.fbaipublicfiles.com/demucs/hybrid_transformer/955717e8-8726e21a.th",
        "sha256": "8726e21a993978c7ba086d3872e7608d7d5bfca646ca4aca459ffda844faa8b4",
        "bytes": 84141911,
    },
    {
        "name": "beat_this-final0.ckpt",
        "url": "https://cloud.cp.jku.at/public.php/dav/files/7ik4RrBKTS273gp/final0.ckpt",
        "sha256": "8c328b45f59d8dd3dff219253ff6a8d6482be57d0133a29140e2febbf8eb8331",
        "bytes": 81058141,
    },
]

APPROVED_HOSTS = {"dl.fbaipublicfiles.com", "cloud.cp.jku.at"}


class _NoOffHostRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        host = urllib.parse.urlsplit(newurl).hostname
        if host not in APPROVED_HOSTS:
            raise SystemExit(f"refusing redirect to {host!r}: only {sorted(APPROVED_HOSTS)} are approved")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def fetch(entry: dict, dest_dir: str) -> None:
    parts = urllib.parse.urlsplit(entry["url"])
    if parts.scheme != "https" or parts.hostname not in APPROVED_HOSTS:
        raise SystemExit(f"{entry['name']}: {entry['url']} is not an approved https URL")
    dest = os.path.join(dest_dir, entry["name"])
    tmp = dest + ".part"
    opener = urllib.request.build_opener(_NoOffHostRedirect)
    digest = hashlib.sha256()
    size = 0
    with opener.open(entry["url"], timeout=120) as resp, open(tmp, "wb") as out:
        while True:
            chunk = resp.read(1 << 20)
            if not chunk:
                break
            digest.update(chunk)
            out.write(chunk)
            size += len(chunk)
    got = digest.hexdigest()
    if size != entry["bytes"] or got != entry["sha256"]:
        os.remove(tmp)
        raise SystemExit(f"{entry['name']}: sha256 {got} ({size} bytes), want {entry['sha256']} ({entry['bytes']} bytes)")
    os.replace(tmp, dest)
    print(f"{entry['name']}: sha256 ok, {size} bytes")


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: fetch_weights.py <dest dir>")
    os.makedirs(sys.argv[1], exist_ok=True)
    for entry in WEIGHTS:
        fetch(entry, sys.argv[1])


if __name__ == "__main__":
    main()
