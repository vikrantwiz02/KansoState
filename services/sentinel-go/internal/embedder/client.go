package embedder

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sync/atomic"
	"time"

	"go.uber.org/zap"

	"github.com/kansostate/sentinel/internal/breaker"
	"github.com/kansostate/sentinel/internal/embedcache"
	"github.com/kansostate/sentinel/internal/metrics"
)

// EmbedRequest is the JSON body sent to the sidecar.
type EmbedRequest struct {
	Texts      []string `json:"texts"`
	ModelHint  string   `json:"model_hint,omitempty"`
	TraceParent string  `json:"traceparent,omitempty"`
}

// EmbedResponse is the JSON body received from the sidecar.
type EmbedResponse struct {
	Vectors [][]float32 `json:"vectors"`
	Model   string      `json:"model"`
	TookMs  int         `json:"took_ms"`
}

// Client round-robins across multiple sidecar replicas with a circuit breaker.
type Client struct {
	urls    []string
	idx     atomic.Uint64
	http    *http.Client
	breaker *breaker.Breaker
	cache   *embedcache.Cache
	log     *zap.Logger
}

// New creates a Client.
func New(urls []string, br *breaker.Breaker, cache *embedcache.Cache, log *zap.Logger) *Client {
	return &Client{
		urls:    urls,
		http:    &http.Client{Timeout: 30 * time.Second},
		breaker: br,
		cache:   cache,
		log:     log,
	}
}

// Embed sends texts to the sidecar and returns embedding vectors.
// Cache hits are returned immediately; only cache-miss texts are sent over the wire.
// If the breaker is open, returns ErrBreakerOpen.
func (c *Client) Embed(ctx context.Context, texts []string) ([][]float32, error) {
	if len(texts) == 0 {
		return nil, nil
	}

	results := make([][]float32, len(texts))
	misses := make([]int, 0, len(texts))
	missTexts := make([]string, 0, len(texts))

	for i, t := range texts {
		if v, ok := c.cache.Get(embedcache.Key(t)); ok {
			results[i] = v
		} else {
			misses = append(misses, i)
			missTexts = append(missTexts, t)
		}
	}

	if len(missTexts) == 0 {
		return results, nil
	}

	metrics.EmbedQueueDepth.Add(float64(len(missTexts)))
	start := time.Now()
	var resp EmbedResponse
	err := c.breaker.Execute(ctx, func() error {
		url := c.nextURL() + "/embed"
		body, _ := json.Marshal(EmbedRequest{Texts: missTexts})
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
		if err != nil {
			return err
		}
		req.Header.Set("Content-Type", "application/json")
		r, err := c.http.Do(req)
		if err != nil {
			return err
		}
		defer r.Body.Close()
		if r.StatusCode != http.StatusOK {
			b, _ := io.ReadAll(io.LimitReader(r.Body, 1024))
			return fmt.Errorf("sidecar %d: %s", r.StatusCode, b)
		}
		return json.NewDecoder(r.Body).Decode(&resp)
	})
	metrics.EmbedQueueDepth.Add(-float64(len(missTexts)))
	metrics.EmbedLatencyMs.Observe(float64(time.Since(start).Milliseconds()))

	if err != nil {
		return nil, err
	}
	if len(resp.Vectors) != len(missTexts) {
		return nil, fmt.Errorf("embedder: got %d vectors for %d texts", len(resp.Vectors), len(missTexts))
	}

	for i, idx := range misses {
		results[idx] = resp.Vectors[i]
		c.cache.Put(embedcache.Key(texts[idx]), resp.Vectors[i])
	}
	return results, nil
}

func (c *Client) nextURL() string {
	n := c.idx.Add(1)
	return c.urls[n%uint64(len(c.urls))]
}
