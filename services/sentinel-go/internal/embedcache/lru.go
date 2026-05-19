package embedcache

import (
	"crypto/sha256"
	"strings"
	"unicode"

	lru "github.com/hashicorp/golang-lru/v2"
	"golang.org/x/sync/singleflight"

	"github.com/kansostate/sentinel/internal/metrics"
)

// Cache is an LRU embedding cache backed by singleflight to deduplicate
// concurrent requests for the same text.
type Cache struct {
	lru    *lru.Cache[[32]byte, []float32]
	group  singleflight.Group
}

// New creates a Cache with cap entries.
func New(cap int) (*Cache, error) {
	l, err := lru.New[[32]byte, []float32](cap)
	if err != nil {
		return nil, err
	}
	return &Cache{lru: l}, nil
}

// Key returns the cache key for a normalized text string.
func Key(text string) [32]byte {
	normalized := normalizeText(text)
	return sha256.Sum256([]byte(normalized))
}

// Get returns the cached vector for the given key, or (nil, false) if absent.
func (c *Cache) Get(key [32]byte) ([]float32, bool) {
	v, ok := c.lru.Get(key)
	if ok {
		metrics.EmbedCacheHits.Inc()
		return v, true
	}
	metrics.EmbedCacheMisses.Inc()
	return nil, false
}

// Put stores a vector under the given key.
func (c *Cache) Put(key [32]byte, vec []float32) {
	c.lru.Add(key, vec)
}

// GetOrFetch checks the cache first; if absent, calls fetch exactly once even
// under concurrent identical requests (singleflight). The result is cached.
func (c *Cache) GetOrFetch(text string, fetch func(string) ([]float32, error)) ([]float32, error) {
	key := Key(text)
	if v, ok := c.Get(key); ok {
		return v, nil
	}
	result, err, _ := c.group.Do(string(key[:]), func() (interface{}, error) {
		// re-check after acquiring the group slot
		if v, ok := c.Get(key); ok {
			return v, nil
		}
		vec, err := fetch(text)
		if err != nil {
			return nil, err
		}
		c.Put(key, vec)
		return vec, nil
	})
	if err != nil {
		return nil, err
	}
	return result.([]float32), nil
}

func normalizeText(s string) string {
	return strings.Map(func(r rune) rune {
		if unicode.IsSpace(r) {
			return ' '
		}
		return unicode.ToLower(r)
	}, strings.TrimSpace(s))
}
