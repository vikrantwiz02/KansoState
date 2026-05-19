package shard

import (
	"context"
	"encoding/json"
	"fmt"
	"math/rand"
	"sync"
	"time"

	"go.uber.org/zap"

	"github.com/kansostate/sentinel/internal/metrics"
	"github.com/kansostate/sentinel/internal/wal"
	"github.com/kansostate/sentinel/pkg/apiv1"
)

const (
	maxEvents = 50
	maxAge    = 10 * time.Second
)

// Writer manages rolling shards for a single meeting.
// Shard writes go through a dedicated goroutine with a bounded channel,
// decoupled from the hot-store read path.
type Writer struct {
	meetingID string
	in        chan apiv1.EmbeddedUtterance
	wal       *wal.WAL
	log       *zap.Logger
	flusher   Flusher
}

// Flusher persists a completed shard.
type Flusher interface {
	Flush(ctx context.Context, meetingID, shardID string, events []ShardEvent) error
}

// ShardEvent is a single record stored in a shard.
type ShardEvent struct {
	Seq          uint64          `json:"seq"`
	SpeakerID    string          `json:"speaker_id"`
	ArrivedAt    time.Time       `json:"arrived_at"`
	RedactedText string          `json:"redacted_text"`
	IntentVec    []float32       `json:"intent_vec"`
	Consensus    float32         `json:"consensus"`
	ConsensusDelta float32       `json:"consensus_delta"`
	VClockJSON   json.RawMessage `json:"vclock_json"`
	ShardID      string          `json:"shard_id"`
}

// NoopFlusher discards shards — used in tests and local dev without Firestore.
type NoopFlusher struct{}

func (NoopFlusher) Flush(_ context.Context, _, _ string, _ []ShardEvent) error { return nil }

// NewWriter creates a Writer for the given meeting.
func NewWriter(meetingID string, w *wal.WAL, flusher Flusher, log *zap.Logger) *Writer {
	return &Writer{
		meetingID: meetingID,
		in:        make(chan apiv1.EmbeddedUtterance, 4096),
		wal:       w,
		log:       log,
		flusher:   flusher,
	}
}

// Submit enqueues an utterance for shard writing. Non-blocking — drops on full buffer.
func (w *Writer) Submit(u apiv1.EmbeddedUtterance) {
	select {
	case w.in <- u:
	default:
		metrics.DropTotal.WithLabelValues("toShard").Inc()
	}
}

// Run processes the shard write queue until ctx is cancelled.
func (w *Writer) Run(ctx context.Context) {
	var (
		events    []ShardEvent
		shardID   = newShardID()
		shardStart = time.Now()
		timer     = time.NewTimer(maxAge)
	)
	defer timer.Stop()

	rollAndFlush := func() {
		if len(events) == 0 {
			return
		}
		id := shardID
		evs := events
		events = nil
		shardID = newShardID()
		shardStart = time.Now()
		timer.Reset(maxAge)
		metrics.ShardRollTotal.Inc()

		go func() {
			if err := w.flusher.Flush(ctx, w.meetingID, id, evs); err != nil {
				w.log.Error("shard: flush failed — writing to WAL",
					zap.String("meeting_id", w.meetingID),
					zap.String("shard_id", id),
					zap.Error(err),
				)
				for _, e := range evs {
					payload, _ := json.Marshal(e)
					_ = w.wal.Append(wal.Entry{
						MeetingID: w.meetingID,
						Seq:       e.Seq,
						Ts:        time.Now(),
						Payload:   payload,
					})
				}
			}
		}()
	}

	for {
		select {
		case <-ctx.Done():
			rollAndFlush()
			return
		case <-timer.C:
			rollAndFlush()
		case u, ok := <-w.in:
			if !ok {
				rollAndFlush()
				return
			}
			vclockJSON, _ := json.Marshal(u.VClock)
			e := ShardEvent{
				Seq:            u.Seq,
				SpeakerID:      u.SpeakerID,
				ArrivedAt:      u.ArrivedAt,
				RedactedText:   u.RedactedText,
				IntentVec:      u.Vec,
				Consensus:      u.ConsensusScore,
				ConsensusDelta: u.ConsensusDelta,
				VClockJSON:     vclockJSON,
				ShardID:        shardID,
			}
			events = append(events, e)
			metrics.ShardWriteTotal.WithLabelValues(w.meetingID).Inc()

			if len(events) >= maxEvents || time.Since(shardStart) >= maxAge {
				rollAndFlush()
			}
		}
	}
}

// ShardMap manages per-meeting Writers with a sharded mutex to avoid lock contention.
type ShardMap struct {
	shards [64]struct {
		sync.RWMutex
		writers map[string]*Writer
	}
}

func NewShardMap() *ShardMap {
	sm := &ShardMap{}
	for i := range sm.shards {
		sm.shards[i].writers = make(map[string]*Writer)
	}
	return sm
}

func (sm *ShardMap) shard(meetingID string) int {
	h := 0
	for _, c := range meetingID {
		h = (h*31 + int(c)) & 0x3f
	}
	return h
}

func (sm *ShardMap) GetOrCreate(ctx context.Context, meetingID string, w *wal.WAL, f Flusher, log *zap.Logger) *Writer {
	idx := sm.shard(meetingID)
	sm.shards[idx].Lock()
	defer sm.shards[idx].Unlock()
	if wr, ok := sm.shards[idx].writers[meetingID]; ok {
		return wr
	}
	wr := NewWriter(meetingID, w, f, log)
	sm.shards[idx].writers[meetingID] = wr
	go wr.Run(ctx)
	return wr
}

func newShardID() string {
	epoch := time.Now().Unix() / 10
	return fmt.Sprintf("%d-%04x", epoch, rand.Intn(0x10000))
}
