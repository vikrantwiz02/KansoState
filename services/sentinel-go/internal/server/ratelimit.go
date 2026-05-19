package server

import (
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// wsRateLimiter enforces a token-bucket per (remoteIP, meetingID) pair.
// Each bucket allows burst connections and refills at refillRate per second.
type wsRateLimiter struct {
	mu       sync.Mutex
	buckets  map[string]*bucket
	capacity int
	refill   float64 // tokens per second
}

type bucket struct {
	tokens float64
	last   time.Time
}

func newWSRateLimiter(capacity int, refillPerSec float64) *wsRateLimiter {
	rl := &wsRateLimiter{
		buckets:  make(map[string]*bucket),
		capacity: capacity,
		refill:   refillPerSec,
	}
	// Prune stale entries every minute to bound memory.
	go func() {
		t := time.NewTicker(time.Minute)
		for range t.C {
			rl.prune()
		}
	}()
	return rl
}

func (rl *wsRateLimiter) allow(ip, meetingID string) bool {
	key := ip + "|" + meetingID
	now := time.Now()

	rl.mu.Lock()
	defer rl.mu.Unlock()

	b, ok := rl.buckets[key]
	if !ok {
		b = &bucket{tokens: float64(rl.capacity), last: now}
		rl.buckets[key] = b
	}

	elapsed := now.Sub(b.last).Seconds()
	b.tokens += elapsed * rl.refill
	if b.tokens > float64(rl.capacity) {
		b.tokens = float64(rl.capacity)
	}
	b.last = now

	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}

func (rl *wsRateLimiter) prune() {
	cutoff := time.Now().Add(-5 * time.Minute)
	rl.mu.Lock()
	defer rl.mu.Unlock()
	for k, b := range rl.buckets {
		if b.last.Before(cutoff) {
			delete(rl.buckets, k)
		}
	}
}

// WSRateLimit returns a Gin middleware that rate-limits WebSocket upgrade
// requests to capacity burst / refillPerSec sustained per (ip, meetingId).
func WSRateLimit(capacity int, refillPerSec float64) gin.HandlerFunc {
	rl := newWSRateLimiter(capacity, refillPerSec)
	return func(c *gin.Context) {
		ip := c.ClientIP()
		meetingID := c.Query("meetingId")
		if !rl.allow(ip, meetingID) {
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{
				"error": "rate limit exceeded",
			})
			return
		}
		c.Next()
	}
}
