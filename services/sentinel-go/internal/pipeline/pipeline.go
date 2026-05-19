package pipeline

import (
	"context"
	"encoding/json"
	"runtime"
	"sync/atomic"
	"time"

	"go.uber.org/zap"

	"github.com/kansostate/sentinel/internal/metrics"
	"github.com/kansostate/sentinel/internal/redact"
	"github.com/kansostate/sentinel/internal/vclock"
	"github.com/kansostate/sentinel/pkg/apiv1"
)

// Fanout receives redacted utterances and forwards them to multiple downstream channels.
type Fanout struct {
	ToEmbedder  chan<- apiv1.Redacted
	ToConsensus chan<- apiv1.EmbeddedUtterance
	ToShard     chan<- apiv1.EmbeddedUtterance
	ToSSE       chan<- apiv1.SSEEnvelope
}

// Pipeline wires together ingest → decode → worker pool (redact) → fanout.
type Pipeline struct {
	rawIn    chan []byte
	pool     *WorkerPool
	bufPool  *BufferPool
	redactor *redact.Redactor
	clocks   *vclock.ClockStore
	fanout   Fanout
	log      *zap.Logger
	seq      atomic.Uint64
}

// Config holds sizing parameters for the pipeline channels and worker pool.
type Config struct {
	RawInBuffer    int
	DecodedBuffer  int
	RedactedBuffer int
	Workers        int
}

// DefaultConfig returns sensible defaults matching the architecture spec.
func DefaultConfig() Config {
	return Config{
		RawInBuffer:    4096,
		DecodedBuffer:  2048,
		RedactedBuffer: 2048,
		Workers:        runtime.NumCPU(),
	}
}

// New creates a Pipeline. fanout channels must be pre-allocated by the caller.
func New(cfg Config, r *redact.Redactor, f Fanout, log *zap.Logger) *Pipeline {
	return &Pipeline{
		rawIn:    make(chan []byte, cfg.RawInBuffer),
		pool:     NewWorkerPool(cfg.Workers, cfg.DecodedBuffer, cfg.RedactedBuffer),
		bufPool:  NewBufferPool(defaultBufSize),
		redactor: r,
		clocks:   vclock.NewClockStore(),
		fanout:   f,
		log:      log,
	}
}

// Ingest accepts a raw WebSocket message. Drops if the buffer is full.
func (p *Pipeline) Ingest(msg []byte) {
	cp := make([]byte, len(msg))
	copy(cp, msg)
	select {
	case p.rawIn <- cp:
	default:
		metrics.DropTotal.WithLabelValues("rawIn").Inc()
	}
}

// Run is the main pipeline loop. Blocks until ctx is cancelled.
func (p *Pipeline) Run(ctx context.Context) {
	heartbeat := time.NewTicker(5 * time.Second)
	defer heartbeat.Stop()

	p.pool.Start(ctx, p.redactWorker)

	go p.fanoutLoop(ctx)

	for {
		select {
		case <-ctx.Done():
			return
		case <-heartbeat.C:
			select {
			case p.fanout.ToSSE <- apiv1.SSEEnvelope{Type: "heartbeat", Seq: p.nextSeq()}:
			default:
				metrics.DropTotal.WithLabelValues("toSSE").Inc()
			}
		case raw, ok := <-p.rawIn:
			if !ok {
				return
			}
			var msg apiv1.WSInbound
			if err := json.Unmarshal(raw, &msg); err != nil {
				p.log.Warn("pipeline: bad message", zap.Error(err))
				continue
			}
			u := apiv1.Utterance{
				MeetingID: msg.MeetingID,
				SpeakerID: msg.SpeakerID,
				Seq:       msg.Seq,
				ArrivedAt: time.Now(),
				Raw:       raw,
				Text:      msg.Payload,
			}
			// update vector clock
			clock := p.clocks.GetOrCreate(msg.MeetingID)
			clock.Tick(msg.SpeakerID)
			u.VClock = apiv1.VClock(clock.Clone())

			if !p.pool.Submit(ctx, WorkItem{Data: u}) {
				metrics.DropTotal.WithLabelValues("decoded").Inc()
			}
		}
	}
}

func (p *Pipeline) redactWorker(item WorkItem) WorkItem {
	u, ok := item.Data.(apiv1.Utterance)
	if !ok {
		return item
	}
	redacted, err := p.redactor.Redact(u)
	if err != nil {
		p.log.Error("pipeline: redact failed", zap.Error(err))
		return WorkItem{Data: nil}
	}
	item.Data = redacted
	return item
}

func (p *Pipeline) fanoutLoop(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case item, ok := <-p.pool.Results():
			if !ok {
				return
			}
			if item.Data == nil {
				continue
			}
			redacted, ok := item.Data.(apiv1.Redacted)
			if !ok {
				continue
			}
			// forward to embedder (non-blocking)
			select {
			case p.fanout.ToEmbedder <- redacted:
			default:
				metrics.DropTotal.WithLabelValues("toEmbedder").Inc()
			}
			// forward SSE utterance event (non-blocking per subscriber)
			select {
			case p.fanout.ToSSE <- apiv1.SSEEnvelope{
				Type:      "utterance",
				MeetingID: redacted.MeetingID,
				Payload:   redacted,
				Seq:       p.nextSeq(),
			}:
			default:
				metrics.DropTotal.WithLabelValues("toSSE").Inc()
			}
		}
	}
}

func (p *Pipeline) nextSeq() uint64 {
	return p.seq.Add(1)
}

// Shutdown drains the pipeline gracefully.
func (p *Pipeline) Shutdown() {
	close(p.rawIn)
	p.pool.Stop()
}
