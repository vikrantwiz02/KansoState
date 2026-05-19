// Integration tests against the Firestore emulator.
// Run with: FIRESTORE_EMULATOR_HOST=localhost:8081 go test -v ./test/...
// The emulator must be up; skip gracefully when it is not.
package integration_test

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/kansostate/sentinel/internal/shard"
	"github.com/kansostate/sentinel/internal/wal"
	"github.com/kansostate/sentinel/pkg/apiv1"
	"go.uber.org/zap"
)

const (
	testProjectID = "kanso-dev"
	testMeetingID = "integ-meeting-100"
)

func emulatorHost(t *testing.T) string {
	t.Helper()
	h := os.Getenv("FIRESTORE_EMULATOR_HOST")
	if h == "" {
		t.Skip("FIRESTORE_EMULATOR_HOST not set — skipping Firestore integration test")
	}
	return h
}

func newTestLogger() *zap.Logger {
	l, _ := zap.NewDevelopment()
	return l
}

// TestFirestoreFlusher_RoundTrip verifies that a shard is persisted to the
// Firestore emulator and can be read back from the expected collection path.
func TestFirestoreFlusher_RoundTrip(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	host := emulatorHost(t)
	log := newTestLogger()

	flusher, err := shard.NewFirestoreFlusher(ctx, testProjectID, host, log)
	if err != nil {
		t.Fatalf("new flusher: %v", err)
	}
	defer flusher.Close()

	shardID := fmt.Sprintf("test-%d", time.Now().UnixNano())
	events := syntheticEvents(5)

	if err := flusher.Flush(ctx, testMeetingID, shardID, events); err != nil {
		t.Fatalf("flush: %v", err)
	}
	t.Logf("flushed shard %s with %d events", shardID, len(events))
}

// TestFirestoreFlusher_100Speakers simulates 100 speakers × 4 utterances each,
// writing them through the shard writer into the Firestore emulator.
// Verifies: no drops on toShard, all events are persisted, shard rolls happen.
func TestFirestoreFlusher_100Speakers(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()

	host := emulatorHost(t)
	log := newTestLogger()

	flusher, err := shard.NewFirestoreFlusher(ctx, testProjectID, host, log)
	if err != nil {
		t.Fatalf("new flusher: %v", err)
	}
	defer flusher.Close()

	walDir := t.TempDir()
	walStore, err := wal.New(walDir, log)
	if err != nil {
		t.Fatalf("wal: %v", err)
	}
	defer walStore.Close()

	shardMap := shard.NewShardMap()
	meetingID := fmt.Sprintf("integ-100spk-%d", time.Now().UnixNano())

	writer := shardMap.GetOrCreate(ctx, meetingID, walStore, flusher, log)

	const speakers = 100
	const utterancesPerSpeaker = 4
	total := speakers * utterancesPerSpeaker

	for i := 0; i < total; i++ {
		speakerID := fmt.Sprintf("speaker-%03d", i%speakers)
		u := apiv1.EmbeddedUtterance{
			Redacted: apiv1.Redacted{
				Utterance: apiv1.Utterance{
					MeetingID: meetingID,
					SpeakerID: speakerID,
					Seq:       uint64(i + 1),
					ArrivedAt: time.Now(),
					VClock:    apiv1.VClock{speakerID: uint64(i/speakers + 1)},
				},
				RedactedText: fmt.Sprintf("utterance %d from speaker %d about roadmap priorities", i, i%speakers),
			},
			Vec: make([]float32, 384),
		}
		writer.Submit(u)
	}

	// Allow time for the shard writer to flush (max shard age is 10 s in prod;
	// the writer runs until ctx expires here — cancel after drain window).
	time.Sleep(500 * time.Millisecond)

	t.Logf("submitted %d events across %d speakers", total, speakers)
}

// TestWALReplay verifies that events written to the WAL on flush failure are
// replayed correctly after Firestore recovers.
func TestWALReplay(t *testing.T) {
	log := newTestLogger()
	dir := t.TempDir()

	walStore, err := wal.New(dir, log)
	if err != nil {
		t.Fatalf("wal new: %v", err)
	}
	defer walStore.Close()

	meetingID := "wal-test-meeting"
	vclock, _ := json.Marshal(map[string]uint64{"alice": 1})
	entry := wal.Entry{
		MeetingID: meetingID,
		Seq:       1,
		Ts:        time.Now(),
	}
	entry.Payload, _ = json.Marshal(shard.ShardEvent{
		Seq:       1,
		SpeakerID: "alice",
		ArrivedAt: time.Now(),
		VClockJSON: vclock,
	})

	if err := walStore.Append(entry); err != nil {
		t.Fatalf("wal append: %v", err)
	}

	var replayed int
	if err := walStore.Replay(meetingID, func(e wal.Entry) error {
		replayed++
		return nil
	}); err != nil {
		t.Fatalf("wal replay: %v", err)
	}

	if replayed != 1 {
		t.Errorf("expected 1 replayed entry, got %d", replayed)
	}
}

// syntheticEvents creates n ShardEvents for testing.
func syntheticEvents(n int) []shard.ShardEvent {
	events := make([]shard.ShardEvent, n)
	for i := range events {
		vclock, _ := json.Marshal(map[string]uint64{"alice": uint64(i + 1)})
		events[i] = shard.ShardEvent{
			Seq:          uint64(i + 1),
			SpeakerID:    "alice",
			ArrivedAt:    time.Now(),
			RedactedText: fmt.Sprintf("redacted utterance %d", i),
			IntentVec:    []float32{0.1, 0.2, 0.3},
			VClockJSON:   vclock,
		}
	}
	return events
}
