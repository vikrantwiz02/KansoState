package breaker

import (
	"context"
	"errors"
	"time"

	"github.com/sony/gobreaker"
	"go.uber.org/zap"

	"github.com/kansostate/sentinel/internal/metrics"
)

// ErrBreakerOpen is returned when the circuit breaker is open and the call is rejected.
var ErrBreakerOpen = errors.New("breaker: circuit open")

// Settings configures the circuit breaker.
type Settings struct {
	MaxRequests uint32
	Interval    time.Duration
	Timeout     time.Duration
}

// DefaultSettings returns settings matching the architecture specification.
func DefaultSettings() Settings {
	return Settings{
		MaxRequests: 5,
		Interval:    30 * time.Second,
		Timeout:     5 * time.Second,
	}
}

// Breaker wraps a callable with Sony gobreaker, exposing open/half-open/closed state.
type Breaker struct {
	cb  *gobreaker.CircuitBreaker
	log *zap.Logger
}

// New creates a Breaker with the given settings.
func New(s Settings, log *zap.Logger) *Breaker {
	b := &Breaker{log: log}
	b.cb = gobreaker.NewCircuitBreaker(gobreaker.Settings{
		Name:        "embedder",
		MaxRequests: s.MaxRequests,
		Interval:    s.Interval,
		Timeout:     s.Timeout,
		ReadyToTrip: func(counts gobreaker.Counts) bool {
			// open after 5 consecutive failures or > 60% failure rate over 10+ requests
			if counts.ConsecutiveFailures >= 5 {
				return true
			}
			if counts.Requests >= 10 {
				failRate := float64(counts.TotalFailures) / float64(counts.Requests)
				return failRate > 0.6
			}
			return false
		},
		OnStateChange: func(name string, from, to gobreaker.State) {
			fromStr := from.String()
			toStr := to.String()
			metrics.BreakerStateChanges.WithLabelValues(fromStr, toStr).Inc()
			if to == gobreaker.StateOpen {
				metrics.BreakerOpen.Set(1)
			} else {
				metrics.BreakerOpen.Set(0)
			}
			log.Warn("breaker: state change",
				zap.String("name", name),
				zap.String("from", fromStr),
				zap.String("to", toStr),
			)
		},
	})
	return b
}

// Execute calls fn through the circuit breaker.
// If the breaker is open, returns ErrBreakerOpen immediately.
func (b *Breaker) Execute(ctx context.Context, fn func() error) error {
	_, err := b.cb.Execute(func() (interface{}, error) {
		return nil, fn()
	})
	if errors.Is(err, gobreaker.ErrOpenState) || errors.Is(err, gobreaker.ErrTooManyRequests) {
		return ErrBreakerOpen
	}
	return err
}

// IsOpen returns true if the circuit breaker is currently open.
func (b *Breaker) IsOpen() bool {
	return b.cb.State() == gobreaker.StateOpen
}

// State returns the current state as a string.
func (b *Breaker) State() string {
	return b.cb.State().String()
}
