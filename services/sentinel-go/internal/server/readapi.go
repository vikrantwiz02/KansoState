package server

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"

	"github.com/kansostate/sentinel/pkg/apiv1"
)

type hydrater interface {
	Hydrate(meetingID string) apiv1.MeetingSnapshot
}

// ListMeetingsHandler returns a Gin handler for GET /api/v1/meetings.
// Returns active meetings from the in-process hot store.
func ListMeetingsHandler(store hotStore, log *zap.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		ids := store.ListMeetings()
		type item struct {
			ID    string `json:"id"`
			Title string `json:"title"`
			State string `json:"state"`
		}
		out := make([]item, len(ids))
		for i, id := range ids {
			out[i] = item{ID: id, Title: id, State: "active"}
		}
		c.JSON(http.StatusOK, out)
	}
}

// ReadAPIHandler returns a Gin handler for GET /api/v1/meetings/:id/hydrate.
// The Next.js server component calls this to bootstrap the meeting view.
// Target p95 < 50 ms (reads from in-process hot store only).
func ReadAPIHandler(store hydrater, log *zap.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		meetingID := c.Param("id")
		if meetingID == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "id required"})
			return
		}

		// Hard 200 ms timeout so slow renders don't block SSR.
		ctx, cancel := apiv1.WithHardTimeout(c.Request.Context(), 200*time.Millisecond)
		defer cancel()
		_ = ctx // snapshot is in-process; ignore timeout for now

		snapshot := store.Hydrate(meetingID)
		c.JSON(http.StatusOK, snapshot)
	}
}
