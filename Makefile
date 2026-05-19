.PHONY: all dev-setup dev-up dev-down seed test test-go test-py test-dash \
        lint lint-go lint-py lint-dash build build-sentinel build-semantic build-dash \
        bench fuzz check-attribution proto clean

GOFLAGS := -race -count=1
SENTINEL_DIR := services/sentinel-go
SEMANTIC_DIR := services/semantic-py
DASHBOARD_DIR := apps/dashboard

all: build test

dev-setup:
	@echo "installing pre-commit hook..."
	@cp scripts/check-attribution.sh .git/hooks/pre-commit 2>/dev/null || true
	@chmod +x .git/hooks/pre-commit 2>/dev/null || true
	@echo "bootstrapping Go modules (go mod tidy)..."
	@bash scripts/bootstrap-go.sh
	@echo "installing Go tools..."
	cd $(SENTINEL_DIR) && go install github.com/golang/mock/mockgen@latest
	@echo "installing Python deps..."
	cd $(SEMANTIC_DIR) && pip install -e ".[dev]"
	@echo "installing dashboard deps..."
	cd $(DASHBOARD_DIR) && pnpm install

dev-up:
	@bash scripts/dev-up.sh

dev-down:
	docker compose down -v

seed:
	@bash scripts/seed-meeting.sh

test: test-go test-py test-dash

test-go:
	cd $(SENTINEL_DIR) && go test $(GOFLAGS) ./...

test-py:
	cd $(SEMANTIC_DIR) && pytest --hypothesis-profile=ci -v

test-dash:
	cd $(DASHBOARD_DIR) && pnpm typecheck && pnpm lint && pnpm test

lint: lint-go lint-py lint-dash

lint-go:
	cd $(SENTINEL_DIR) && go vet ./... && golangci-lint run

lint-py:
	cd $(SEMANTIC_DIR) && ruff check . && mypy --strict src/

lint-dash:
	cd $(DASHBOARD_DIR) && pnpm lint && pnpm typecheck

build: build-sentinel build-semantic build-dash

build-sentinel:
	cd $(SENTINEL_DIR) && go build -o bin/sentinel ./cmd/sentinel

build-semantic:
	cd $(SEMANTIC_DIR) && pip install -e .

build-dash:
	cd $(DASHBOARD_DIR) && pnpm build

bench:
	cd $(SENTINEL_DIR) && go test -bench=. -benchmem -run='^$$' ./...

fuzz:
	cd $(SENTINEL_DIR) && go test -fuzz=FuzzRedact -fuzztime=60s ./internal/redact/...

check-attribution:
	@bash scripts/check-attribution.sh

proto:
	@bash scripts/gen-proto.sh

clean:
	cd $(SENTINEL_DIR) && rm -rf bin/ coverage.out
	cd $(SEMANTIC_DIR) && find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
	cd $(DASHBOARD_DIR) && rm -rf .next out
