package server

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"

	"github.com/kansostate/sentinel/internal/metrics"
	"github.com/kansostate/sentinel/pkg/apiv1"

	"github.com/gorilla/websocket"
)

const (
	wsMaxMessageBytes = 64 * 1024 // 64 KB — prevents memory exhaustion from large payloads
	wsMaxIDLen        = 128
)

type ingestor interface {
	Ingest(msg []byte)
}

// WSHandler returns a Gin handler for the /ws endpoint.
// allowedOrigins restricts which Origin headers are accepted; pass nil/empty to allow all (dev only).
func WSHandler(ingest ingestor, allowedOrigins []string, log *zap.Logger) gin.HandlerFunc {
	upgrader := websocket.Upgrader{
		ReadBufferSize:  4096,
		WriteBufferSize: 4096,
		CheckOrigin: func(r *http.Request) bool {
			origin := r.Header.Get("Origin")
			// Non-browser clients (native apps, CLIs) don't send Origin.
			// CSRF is a browser-only attack; if there's no Origin the request
			// cannot be cross-origin browser traffic, so allow it.
			if origin == "" {
				return true
			}
			if len(allowedOrigins) == 0 {
				return true // dev mode — no origin restrictions
			}
			for _, a := range allowedOrigins {
				if strings.EqualFold(origin, a) {
					return true
				}
			}
			return false
		},
	}

	return func(c *gin.Context) {
		meetingID := c.Query("meetingId")
		if meetingID == "" || len(meetingID) > wsMaxIDLen {
			c.JSON(http.StatusBadRequest, gin.H{"error": "meetingId required (max 128 chars)"})
			return
		}

		conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
		if err != nil {
			log.Warn("ws: upgrade failed", zap.Error(err))
			return
		}
		defer conn.Close()

		conn.SetReadLimit(wsMaxMessageBytes)
		metrics.ActiveConnections.Inc()
		defer metrics.ActiveConnections.Dec()

		_ = conn.SetReadDeadline(time.Now().Add(30 * time.Second))
		conn.SetPongHandler(func(string) error {
			_ = conn.SetReadDeadline(time.Now().Add(30 * time.Second))
			return nil
		})

		pingTicker := time.NewTicker(15 * time.Second)
		defer pingTicker.Stop()

		done := make(chan struct{})
		go func() {
			defer close(done)
			for {
				mt, msg, err := conn.ReadMessage()
				if err != nil {
					return
				}
				if mt != websocket.TextMessage && mt != websocket.BinaryMessage {
					continue
				}

				// Validate that message meeting_id and speaker_id are sane and match URL.
				var probe apiv1.WSInbound
				if err := json.Unmarshal(msg, &probe); err != nil {
					continue // drop malformed messages
				}
				if probe.MeetingID != meetingID {
					log.Warn("ws: meeting_id mismatch — dropping",
						zap.String("url_id", meetingID),
						zap.String("msg_id", probe.MeetingID))
					continue
				}
				if probe.SpeakerID == "" || len(probe.SpeakerID) > wsMaxIDLen {
					continue
				}

				ingest.Ingest(msg)

				ack := apiv1.WSAck{ServerTsMs: time.Now().UnixMilli()}
				if err := conn.WriteJSON(ack); err != nil {
					log.Warn("ws: write ack failed", zap.Error(err))
					return
				}
			}
		}()

		for {
			select {
			case <-done:
				return
			case <-pingTicker.C:
				_ = conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
				if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
					return
				}
			}
		}
	}
}
