package server

import (
	"encoding/json"
	"net/http"
	"strings"
	"sync"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"go.uber.org/zap"
)

// signalMsg is the envelope exchanged over the signaling channel.
// type: room-state | peer-joined | peer-left | offer | answer | ice
// to:   empty = broadcast, non-empty = unicast to that peer
type signalMsg struct {
	Type    string          `json:"type"`
	From    string          `json:"from"`
	To      string          `json:"to,omitempty"`
	Payload json.RawMessage `json:"payload,omitempty"`
}

type signalPeer struct {
	id     string
	send   chan []byte
	conn   *websocket.Conn
	closed chan struct{} // closed when peer.send is no longer safe to write to
}

type signalRoom struct {
	mu    sync.RWMutex
	peers map[string]*signalPeer
}

// SignalHub manages one signalRoom per meeting.
type SignalHub struct {
	mu    sync.RWMutex
	rooms map[string]*signalRoom
}

func NewSignalHub() *SignalHub {
	return &SignalHub{rooms: make(map[string]*signalRoom)}
}

func (h *SignalHub) room(id string) *signalRoom {
	h.mu.Lock()
	defer h.mu.Unlock()
	if r, ok := h.rooms[id]; ok {
		return r
	}
	r := &signalRoom{peers: make(map[string]*signalPeer)}
	h.rooms[id] = r
	return r
}

// cleanupRoom removes a room from the hub if it has no peers.
func (h *SignalHub) cleanupRoom(id string, room *signalRoom) {
	room.mu.RLock()
	empty := len(room.peers) == 0
	room.mu.RUnlock()
	if !empty {
		return
	}
	h.mu.Lock()
	// Re-check under write lock to avoid TOCTOU.
	if r, ok := h.rooms[id]; ok {
		r.mu.RLock()
		stillEmpty := len(r.peers) == 0
		r.mu.RUnlock()
		if stillEmpty {
			delete(h.rooms, id)
		}
	}
	h.mu.Unlock()
}

// trySend delivers a message to a peer without blocking.
// Returns false and does nothing if the peer has already left.
func trySend(peer *signalPeer, raw []byte) {
	select {
	case <-peer.closed:
		// Peer already closed; discard safely — no panic on closed channel.
	default:
		select {
		case peer.send <- raw:
		default:
			// Channel full; drop rather than block.
		}
	}
}

// Handler returns the Gin handler for /ws/signal.
func (h *SignalHub) Handler(allowedOrigins []string, log *zap.Logger) gin.HandlerFunc {
	upgrader := websocket.Upgrader{
		ReadBufferSize:  4096,
		WriteBufferSize: 4096,
		CheckOrigin: func(r *http.Request) bool {
			origin := r.Header.Get("Origin")
			if origin == "" {
				return true
			}
			if len(allowedOrigins) == 0 {
				return true
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
		peerID := c.Query("peerId")
		if meetingID == "" || len(meetingID) > wsMaxIDLen || peerID == "" || len(peerID) > wsMaxIDLen {
			c.JSON(http.StatusBadRequest, gin.H{"error": "meetingId and peerId required (max 128 chars each)"})
			return
		}

		conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
		if err != nil {
			log.Warn("signal: upgrade failed", zap.Error(err))
			return
		}

		// 512-slot buffer; large enough that a slow peer won't drop signaling
		// messages (offers/answers/ICE) during normal load.
		peer := &signalPeer{
			id:     peerID,
			send:   make(chan []byte, 512),
			conn:   conn,
			closed: make(chan struct{}),
		}
		room := h.room(meetingID)

		// Register peer; collect existing peers to send room-state.
		room.mu.Lock()
		existing := make([]string, 0, len(room.peers))
		for id := range room.peers {
			existing = append(existing, id)
		}
		room.peers[peerID] = peer
		room.mu.Unlock()

		// Send room-state to the new peer.
		statePayload, _ := json.Marshal(map[string]interface{}{"peers": existing})
		h.sendTo(peer, signalMsg{Type: "room-state", From: "server", Payload: statePayload})

		// Notify existing peers.
		h.broadcast(room, peerID, signalMsg{Type: "peer-joined", From: peerID})

		// Write pump: drains peer.send until the channel is closed.
		writeDone := make(chan struct{})
		go func() {
			defer close(writeDone)
			for data := range peer.send {
				if err := conn.WriteMessage(websocket.TextMessage, data); err != nil {
					// Drain remaining messages so the range loop exits cleanly
					// when the channel is eventually closed by the defer below.
					for range peer.send { //nolint:revive
					}
					return
				}
			}
		}()

		// Read pump — relay messages between peers.
		conn.SetReadLimit(wsMaxMessageBytes)
		defer func() {
			conn.Close()

			// Unregister peer.
			room.mu.Lock()
			delete(room.peers, peerID)
			room.mu.Unlock()

			// Signal write pump to stop, then wait for it.
			close(peer.closed) // mark as closed so trySend becomes a no-op
			close(peer.send)   // unblocks the write pump's range loop
			<-writeDone

			// Notify others and clean up room if empty.
			h.broadcast(room, peerID, signalMsg{Type: "peer-left", From: peerID})
			h.cleanupRoom(meetingID, room)
			log.Info("signal: peer left", zap.String("meeting", meetingID), zap.String("peer", peerID))
		}()

		log.Info("signal: peer joined", zap.String("meeting", meetingID), zap.String("peer", peerID))

		for {
			_, data, err := conn.ReadMessage()
			if err != nil {
				return
			}
			var msg signalMsg
			if err := json.Unmarshal(data, &msg); err != nil {
				continue
			}
			msg.From = peerID // enforce sender identity

			if msg.To != "" {
				// Unicast (offer / answer / ice).
				room.mu.RLock()
				target := room.peers[msg.To]
				room.mu.RUnlock()
				if target != nil {
					raw, _ := json.Marshal(msg)
					trySend(target, raw)
				}
			} else {
				h.broadcast(room, peerID, msg)
			}
		}
	}
}

func (h *SignalHub) sendTo(peer *signalPeer, msg signalMsg) {
	raw, _ := json.Marshal(msg)
	trySend(peer, raw)
}

func (h *SignalHub) broadcast(room *signalRoom, exceptID string, msg signalMsg) {
	raw, _ := json.Marshal(msg)
	room.mu.RLock()
	defer room.mu.RUnlock()
	for id, p := range room.peers {
		if id == exceptID {
			continue
		}
		trySend(p, raw)
	}
}
