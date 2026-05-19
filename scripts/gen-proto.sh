#!/usr/bin/env bash
set -euo pipefail

command -v protoc >/dev/null 2>&1 || { echo "protoc not found. Install via: brew install protobuf"; exit 1; }
command -v protoc-gen-go >/dev/null 2>&1 || go install google.golang.org/protobuf/cmd/protoc-gen-go@latest

PROTO_DIR="proto"
GO_OUT="services/sentinel-go/gen"
mkdir -p "$GO_OUT"

find "$PROTO_DIR" -name "*.proto" | while read -r f; do
  protoc \
    --proto_path="$PROTO_DIR" \
    --go_out="$GO_OUT" \
    --go_opt=paths=source_relative \
    "$f"
  echo "generated: $f"
done
