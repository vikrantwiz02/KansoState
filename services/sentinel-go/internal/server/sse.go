package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"

	"github.com/kansostate/sentinel/internal/metrics"
	"github.com/kansostate/sentinel/pkg/apiv1"
)

type hotStore interface {
	Hydrate(meetingID string) apiv1.MeetingSnapshot
	Subscribe(meetingID string) (<-chan apiv1.SSEEnvelope, func())
	ListMeetings() []string
}

// SSEHandler returns a Gin handler for the /sse endpoint.
// Clients connect with ?meetingId=... and optionally Last-Event-Id for resumption.
func SSEHandler(store hotStore, log *zap.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		meetingID := c.Query("meetingId")
		if meetingID == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "meetingId required"})
			return
		}

		lastSeq := uint64(0)
		if leid := c.GetHeader("Last-Event-Id"); leid != "" {
			if n, err := strconv.ParseUint(leid, 10, 64); err == nil {
				lastSeq = n
			}
		}

		c.Header("Content-Type", "text/event-stream")
		c.Header("Cache-Control", "no-cache")
		c.Header("Connection", "keep-alive")
		c.Header("X-Accel-Buffering", "no")

		metrics.SSESubscribers.Inc()
		defer metrics.SSESubscribers.Dec()

		// replay ring buffer events after lastSeq
		snapshot := store.Hydrate(meetingID)
		for _, env := range snapshot.Events {
			if env.Seq <= lastSeq {
				continue
			}
			writeSSEEvent(c, env)
		}

		ch, cancel := store.Subscribe(meetingID)
		defer cancel()

		for {
			select {
			case <-c.Request.Context().Done():
				return
			case env, ok := <-ch:
				if !ok {
					return
				}
				if env.Type == "shutdown" {
					writeSSEEvent(c, env)
					return
				}
				writeSSEEvent(c, env)
				c.Writer.Flush()
			}
		}
	}
}

func writeSSEEvent(c *gin.Context, env apiv1.SSEEnvelope) {
	data, err := json.Marshal(env)
	if err != nil {
		return
	}
	fmt.Fprintf(c.Writer, "id: %d\nevent: %s\ndata: %s\n\n", env.Seq, env.Type, data)
}
