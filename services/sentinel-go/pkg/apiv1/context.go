package apiv1

import (
	"context"
	"time"
)

// WithHardTimeout returns a context that is cancelled after d.
func WithHardTimeout(parent context.Context, d time.Duration) (context.Context, context.CancelFunc) {
	return context.WithTimeout(parent, d)
}
