// Benchmarks for the full pipeline path: ingest → redact → fanout.
package integration_test

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"go.uber.org/zap"

	"github.com/kansostate/sentinel/internal/pipeline"
	"github.com/kansostate/sentinel/internal/redact"
	"github.com/kansostate/sentinel/pkg/apiv1"
)

func BenchmarkPipeline_Ingest200msg(b *testing.B) {
	log, _ := zap.NewNop(), error(nil)
	r, err := redact.New("../internal/redact/dictionaries")
	if err != nil {
		b.Fatalf("redactor: %v", err)
	}

	toEmbedder := make(chan apiv1.Redacted, 2048)
	toConsensus := make(chan apiv1.EmbeddedUtterance, 2048)
	toShard := make(chan apiv1.EmbeddedUtterance, 4096)
	toSSE := make(chan apiv1.SSEEnvelope, 1024)

	fanout := pipeline.Fanout{
		ToEmbedder:  toEmbedder,
		ToConsensus: toConsensus,
		ToShard:     toShard,
		ToSSE:       toSSE,
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	pipe := pipeline.New(pipeline.DefaultConfig(), r, fanout, log)
	go pipe.Run(ctx)

	msg := apiv1.WSInbound{
		Type:       "text_chunk",
		MeetingID:  "bench-meeting",
		SpeakerID:  "alice",
		TsClientMs: time.Now().UnixMilli(),
		Payload:    "let's align on the Q3 roadmap before the sprint review",
	}
	raw, _ := json.Marshal(msg)

	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		msg.Seq = uint64(i)
		raw, _ = json.Marshal(msg)
		pipe.Ingest(raw)
	}
}
