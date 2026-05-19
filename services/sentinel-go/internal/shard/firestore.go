package shard

import (
	"context"
	"fmt"
	"time"

	"cloud.google.com/go/firestore"
	"go.uber.org/zap"
	"google.golang.org/api/option"
)

// FirestoreFlusher persists completed shards to Firestore.
// Each shard lands at meetings/{meetingId}/shards/{shardId}.
type FirestoreFlusher struct {
	client *firestore.Client
	log    *zap.Logger
}

// NewFirestoreFlusher creates a flusher. Pass emulatorHost non-empty (host:port)
// to use the Firestore emulator instead of the production service.
func NewFirestoreFlusher(ctx context.Context, projectID, emulatorHost string, log *zap.Logger) (*FirestoreFlusher, error) {
	var opts []option.ClientOption
	if emulatorHost != "" {
		opts = append(opts,
			option.WithoutAuthentication(),
			option.WithEndpoint("http://"+emulatorHost),
		)
	}
	client, err := firestore.NewClient(ctx, projectID, opts...)
	if err != nil {
		return nil, fmt.Errorf("shard/firestore: new client: %w", err)
	}
	return &FirestoreFlusher{client: client, log: log}, nil
}

// Flush writes a shard document and, when write count hits the first shard for a
// meeting, initialises the meeting document if absent.
func (f *FirestoreFlusher) Flush(ctx context.Context, meetingID, shardID string, events []ShardEvent) error {
	if len(events) == 0 {
		return nil
	}

	rows := make([]map[string]interface{}, 0, len(events))
	for _, e := range events {
		rows = append(rows, map[string]interface{}{
			"seq":             e.Seq,
			"speaker_id":      e.SpeakerID,
			"arrived_at":      e.ArrivedAt,
			"redacted_text":   e.RedactedText,
			"intent_vec":      float32ToAny(e.IntentVec),
			"consensus":       e.Consensus,
			"consensus_delta": e.ConsensusDelta,
			"vclock_json":     string(e.VClockJSON),
			"shard_id":        shardID,
		})
	}

	shardDoc := map[string]interface{}{
		"meeting_id":  meetingID,
		"shard_id":    shardID,
		"start_ts":    events[0].ArrivedAt,
		"end_ts":      events[len(events)-1].ArrivedAt,
		"events":      rows,
		"write_count": len(events),
		"written_at":  time.Now(),
	}

	ref := f.client.Collection("meetings").Doc(meetingID).Collection("shards").Doc(shardID)
	if _, err := ref.Set(ctx, shardDoc); err != nil {
		return fmt.Errorf("shard/firestore: set shard %s/%s: %w", meetingID, shardID, err)
	}
	f.log.Debug("shard flushed to firestore",
		zap.String("meeting_id", meetingID),
		zap.String("shard_id", shardID),
		zap.Int("events", len(events)),
	)
	return nil
}

// FinalizeMeeting writes the control document that triggers the Cloud Function
// to stream this meeting's shards to BigQuery.
func (f *FirestoreFlusher) FinalizeMeeting(ctx context.Context, meetingID string) error {
	ref := f.client.Collection("meetings").Doc(meetingID).Collection("control").Doc("finalized")
	_, err := ref.Set(ctx, map[string]interface{}{
		"finalized_at": time.Now(),
		"meeting_id":   meetingID,
	})
	return err
}

// Close releases the underlying Firestore connection.
func (f *FirestoreFlusher) Close() error {
	return f.client.Close()
}

func float32ToAny(v []float32) []interface{} {
	out := make([]interface{}, len(v))
	for i, f := range v {
		out[i] = float64(f) // Firestore stores numbers as float64
	}
	return out
}
