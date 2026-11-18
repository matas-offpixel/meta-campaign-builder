# syntax=docker/dockerfile:1.7
#
# Top tracks analysis host: Beat This! (final0) + Demucs (htdemucs), one
# synchronous call per audio file version (TK13, TK14, TK18). Built and
# pushed by scripts/top-tracks-analysis-deploy.mts for linux/arm64 (Graviton:
# 20 % cheaper per GB-s than x86_64, and a native build on an Apple-silicon Mac).
#
#   docker buildx build --platform linux/arm64 --provenance=false -t top-tracks-analysis infra/top-tracks-analysis
#
# --provenance=false matters: Lambda rejects the image index buildx makes for
# attestations.

ARG BASE_IMAGE=public.ecr.aws/lambda/python:3.12

# 1. The weights, from their official hosts only, checked against their sha256
#    pins. A mismatch fails the build.
FROM ${BASE_IMAGE} AS weights
COPY fetch_weights.py /build/fetch_weights.py
RUN python3 -I /build/fetch_weights.py /opt/torch/hub/checkpoints

# 2. The runtime.
FROM ${BASE_IMAGE}

# torch's aarch64 wheel on the CPU index is CPU-only (no CUDA, ~180 MB).
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu \
      torch==2.5.1 torchaudio==2.5.1
COPY requirements.txt /build/requirements.txt
RUN pip install --no-cache-dir -r /build/requirements.txt \
 && python3 -c "import torch, torchaudio, demucs, beat_this, soundfile, soxr; assert soundfile.__libsndfile_version__ >= '1.1', soundfile.__libsndfile_version__"

COPY --from=weights /opt/torch /opt/torch
ENV TORCH_HOME=/opt/torch \
    XDG_CACHE_HOME=/tmp/.cache \
    PYTHONDONTWRITEBYTECODE=1 \
    MAX_AUDIO_SECONDS=480

COPY app/ ${LAMBDA_TASK_ROOT}/

# Fail the build if the handler can't import or the weights aren't where torch.hub looks.
RUN cd ${LAMBDA_TASK_ROOT} && python3 -c "import handler; print(handler.check_weights())"

CMD ["handler.handler"]
