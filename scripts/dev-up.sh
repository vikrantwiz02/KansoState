#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

echo "starting KansoState dev stack..."
docker compose up --build -d

echo "waiting for sentinel..."
until curl -sf http://localhost:8080/healthz > /dev/null 2>&1; do
  sleep 1
done
echo "sentinel ready"

echo "waiting for semantic sidecar..."
until curl -sf http://localhost:8090/healthz > /dev/null 2>&1; do
  sleep 1
done
echo "semantic sidecar ready"

echo "stack up. services:"
echo "  sentinel:        http://localhost:8080"
echo "  semantic:        http://localhost:8090"
echo "  dashboard:       http://localhost:3000"
echo "  prometheus:      http://localhost:9090"
echo "  grafana:         http://localhost:3001"
echo "  firestore emu:   http://localhost:8081"
