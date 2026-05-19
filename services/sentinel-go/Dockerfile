FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o bin/sentinel ./cmd/sentinel

FROM gcr.io/distroless/static-debian12
COPY --from=builder /app/bin/sentinel /sentinel
COPY --from=builder /app/internal/redact/dictionaries /internal/redact/dictionaries
ENV REDACTION_DICT_DIR=/internal/redact/dictionaries
EXPOSE 8080 9100
ENTRYPOINT ["/sentinel"]
