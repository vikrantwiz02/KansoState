#!/usr/bin/env bash
# Run once after cloning to generate go.sum and download modules.
# Requires: Go 1.22+
set -euo pipefail

cd "$(dirname "$0")/../services/sentinel-go"

echo "generating go.sum for sentinel-go..."
go mod tidy
echo "go.sum generated"

cd "$(dirname "$0")/../infra/functions/finalize"
echo "generating go.sum for finalize function..."
go mod tidy
echo "go.sum generated"
