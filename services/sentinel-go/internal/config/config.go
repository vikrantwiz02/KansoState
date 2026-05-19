package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Env  string
	HTTP HTTPConfig
	WS   WSConfig
	Log  LogConfig

	EmbedderURLs    []string
	EmbedBatchSize  int
	EmbedFlushEvery time.Duration

	LRUCacheSize int
	HotStoreRingDuration time.Duration
	HotStoreLRUShards    int

	WALDir string

	BreakerMaxRequests uint32
	BreakerInterval    time.Duration
	BreakerTimeout     time.Duration

	ShardMaxEvents   int
	ShardMaxAge      time.Duration

	FirestoreProjectID string
	FirestoreEmulator  string

	RedactionDictDir string
	DebugUnsafe      bool
	APIKey           string // if non-empty, required on all non-health endpoints
	AllowedOrigins   []string
}

type HTTPConfig struct {
	Addr         string
	ReadTimeout  time.Duration
	WriteTimeout time.Duration
	IdleTimeout  time.Duration
}

type WSConfig struct {
	RawInBuffer  int
	DecodedBuffer int
}

type LogConfig struct {
	Level string
}

func Load() (*Config, error) {
	cfg := &Config{
		Env:  getEnv("KANSO_ENV", "development"),
		HTTP: HTTPConfig{
			Addr:         getEnv("HTTP_ADDR", ":8080"),
			ReadTimeout:  getDuration("HTTP_READ_TIMEOUT", 30*time.Second),
			WriteTimeout: getDuration("HTTP_WRITE_TIMEOUT", 30*time.Second),
			IdleTimeout:  getDuration("HTTP_IDLE_TIMEOUT", 120*time.Second),
		},
		WS: WSConfig{
			RawInBuffer:   getInt("WS_RAWIN_BUFFER", 4096),
			DecodedBuffer: getInt("WS_DECODED_BUFFER", 2048),
		},
		Log: LogConfig{
			Level: getEnv("LOG_LEVEL", "info"),
		},
		EmbedderURLs:         splitCSV(getEnv("EMBEDDER_URLS", "http://localhost:8090")),
		EmbedBatchSize:       getInt("EMBED_BATCH_SIZE", 64),
		EmbedFlushEvery:      getDuration("EMBED_FLUSH_EVERY", 50*time.Millisecond),
		LRUCacheSize:         getInt("LRU_CACHE_SIZE", 100_000),
		HotStoreRingDuration: getDuration("HOTSTORE_RING_DURATION", 60*time.Second),
		HotStoreLRUShards:    getInt("HOTSTORE_LRU_SHARDS", 50),
		WALDir:               getEnv("WAL_DIR", "/var/lib/kanso/wal"),
		BreakerMaxRequests:   uint32(getInt("BREAKER_MAX_REQUESTS", 5)),
		BreakerInterval:      getDuration("BREAKER_INTERVAL", 30*time.Second),
		BreakerTimeout:       getDuration("BREAKER_TIMEOUT", 5*time.Second),
		ShardMaxEvents:       getInt("SHARD_MAX_EVENTS", 50),
		ShardMaxAge:          getDuration("SHARD_MAX_AGE", 10*time.Second),
		FirestoreProjectID:   getEnv("FIRESTORE_PROJECT_ID", "kanso-dev"),
		FirestoreEmulator:    getEnv("FIRESTORE_EMULATOR_HOST", ""),
		RedactionDictDir:     getEnv("REDACTION_DICT_DIR", "internal/redact/dictionaries"),
		DebugUnsafe:          getBool("DEBUG_UNSAFE", false),
		APIKey:               getEnv("SENTINEL_API_KEY", ""),
		AllowedOrigins:       splitCSV(getEnv("ALLOWED_ORIGINS", "http://localhost:3000")),
	}

	if err := cfg.validate(); err != nil {
		return nil, err
	}
	return cfg, nil
}

func (c *Config) validate() error {
	if len(c.EmbedderURLs) == 0 {
		return fmt.Errorf("EMBEDDER_URLS must not be empty")
	}
	if c.DebugUnsafe && c.Env == "production" {
		return fmt.Errorf("DEBUG_UNSAFE must not be set in production")
	}
	return nil
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func getInt(key string, fallback int) int {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return fallback
	}
	return n
}

func getBool(key string, fallback bool) bool {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	b, err := strconv.ParseBool(v)
	if err != nil {
		return fallback
	}
	return b
}

func getDuration(key string, fallback time.Duration) time.Duration {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	d, err := time.ParseDuration(v)
	if err != nil {
		return fallback
	}
	return d
}

func splitCSV(s string) []string {
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if t := strings.TrimSpace(p); t != "" {
			out = append(out, t)
		}
	}
	return out
}
