package apiv1

import "time"

// TokenKind classifies a redacted PII token.
type TokenKind string

const (
	TokenKindEmail    TokenKind = "EMAIL"
	TokenKindCard     TokenKind = "CARD"
	TokenKindPhone    TokenKind = "PHONE"
	TokenKindIBAN     TokenKind = "IBAN"
	TokenKindMyNumber TokenKind = "MYNUMBER"
	TokenKindName     TokenKind = "NAME"
	TokenKindKeyword  TokenKind = "KEYWORD"
)

// Token is a single redacted span.
type Token struct {
	Kind        TokenKind `json:"kind"`
	Placeholder string    `json:"placeholder"`
	Start       int       `json:"start"`
	End         int       `json:"end"`
	Hash        [32]byte  `json:"hash"`
}

// VClock is a logical vector clock: participant ID → counter.
type VClock map[string]uint64

// Utterance is the raw decoded message from a WebSocket client.
type Utterance struct {
	MeetingID string    `json:"meeting_id"`
	SpeakerID string    `json:"speaker_id"`
	Seq       uint64    `json:"seq"`
	ArrivedAt time.Time `json:"arrived_at"`
	Raw       []byte    `json:"-"` // never sent over the wire
	Text      string    `json:"-"` // pre-redaction; use RedactedText instead
	VClock    VClock    `json:"vclock"`
}

// Redacted is an Utterance with PII replaced.
type Redacted struct {
	Utterance
	Redactions   []Token `json:"redactions"`
	RedactedText string  `json:"redacted_text"`
}

// EmbeddedUtterance is a Redacted utterance with its embedding vector attached.
type EmbeddedUtterance struct {
	Redacted
	Vec            []float32 `json:"vec,omitempty"`
	Model          string    `json:"model,omitempty"`
	EmbedMs        int       `json:"embed_ms,omitempty"`
	ConsensusScore float32   `json:"consensus_score,omitempty"`
	ConsensusDelta float32   `json:"consensus_delta,omitempty"`
}

// ConsensusEvent is emitted by the consensus engine for SSE delivery.
type ConsensusEvent struct {
	MeetingID string  `json:"meeting_id"`
	SpeakerID string  `json:"speaker_id"`
	Score     float32 `json:"score"`
	Delta     float32 `json:"delta"`
	Drift     float32 `json:"drift"`
	Stale     bool    `json:"stale"`
	Seq       uint64  `json:"seq"`
}

// SSEEnvelope wraps events streamed to the dashboard.
type SSEEnvelope struct {
	Type      string      `json:"type"`       // "utterance" | "consensus" | "bridge" | "heartbeat" | "shutdown"
	MeetingID string      `json:"meeting_id"` // set for meeting-scoped events
	Payload   interface{} `json:"payload"`
	Seq       uint64      `json:"seq"`
}

// WSInbound is a client message received over WebSocket.
type WSInbound struct {
	Type       string `json:"type"`
	MeetingID  string `json:"meeting_id"`
	SpeakerID  string `json:"speaker_id"`
	Seq        uint64 `json:"seq"`
	TsClientMs int64  `json:"ts_client_ms"`
	Payload    string `json:"payload"`
}

// WSAck is the acknowledgment sent back to the WS client.
type WSAck struct {
	AckSeq     uint64 `json:"ack_seq"`
	ServerTsMs int64  `json:"server_ts_ms"`
	LagMs      int64  `json:"lag_ms"`
}

// BridgeNote is a cultural-context annotation for a meeting window.
type BridgeNote struct {
	MeetingID string   `json:"meeting_id"`
	Tags      []string `json:"tags"`
	Note      string   `json:"note"`
	Ts        time.Time `json:"ts"`
}

// MeetingSnapshot is returned by the hydrate endpoint.
type MeetingSnapshot struct {
	MeetingID      string        `json:"meeting_id"`
	Events         []SSEEnvelope `json:"events"`
	VClock         VClock        `json:"vclock"`
	ConsensusScore float32       `json:"consensus_score"`
	Stale          bool          `json:"stale"`
}
