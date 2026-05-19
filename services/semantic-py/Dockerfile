FROM python:3.11-slim AS base
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml ./
COPY src/ src/

# Install CPU-only torch first to avoid pulling the 2 GB CUDA wheel.
RUN pip install --no-cache-dir \
      torch --index-url https://download.pytorch.org/whl/cpu

# Install the rest of the package dependencies.
RUN pip install --no-cache-dir . && pip cache purge

EXPOSE 8090
HEALTHCHECK --interval=10s --timeout=3s --retries=3 \
  CMD curl -f http://localhost:8090/healthz || exit 1

CMD ["python", "-m", "semantic.main"]
