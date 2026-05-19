package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"sync"
	"syscall"
	"time"

	"go.uber.org/zap"
	"golang.org/x/sync/errgroup"

	"github.com/kansostate/sentinel/internal/breaker"
	"github.com/kansostate/sentinel/internal/config"
	"github.com/kansostate/sentinel/internal/consensus"
	"github.com/kansostate/sentinel/internal/embedcache"
	"github.com/kansostate/sentinel/internal/embedder"
	"github.com/kansostate/sentinel/internal/hotstore"
	applog "github.com/kansostate/sentinel/internal/log"
	"github.com/kansostate/sentinel/internal/pipeline"
	"github.com/kansostate/sentinel/internal/redact"
	"github.com/kansostate/sentinel/internal/shard"
	"github.com/kansostate/sentinel/internal/server"
	"github.com/kansostate/sentinel/internal/wal"
	"github.com/kansostate/sentinel/pkg/apiv1"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		panic("config: " + err.Error())
	}

	log, err := applog.New(cfg.Log.Level, cfg.Env, cfg.DebugUnsafe)
	if err != nil {
		panic("log: " + err.Error())
	}
	defer func() { _ = log.Sync() }()

	if err := run(cfg, log); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal("sentinel: fatal error", zap.Error(err))
		os.Exit(1)
	}
}

func run(cfg *config.Config, log *zap.Logger) error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	walStore, err := wal.New(cfg.WALDir, log)
	if err != nil {
		return err
	}
	defer walStore.Close()

	// Firestore flusher — falls back to NoopFlusher if project ID is unset (local dev).
	var shardFlusher shard.Flusher = shard.NoopFlusher{}
	if cfg.FirestoreProjectID != "" && cfg.FirestoreProjectID != "kanso-dev" {
		ff, err := shard.NewFirestoreFlusher(ctx, cfg.FirestoreProjectID, cfg.FirestoreEmulator, log)
		if err != nil {
			log.Warn("firestore flusher unavailable — using noop", zap.Error(err))
		} else {
			shardFlusher = ff
			defer ff.Close()
		}
	} else if cfg.FirestoreEmulator != "" {
		// emulator mode (docker compose dev stack)
		ff, err := shard.NewFirestoreFlusher(ctx, cfg.FirestoreProjectID, cfg.FirestoreEmulator, log)
		if err != nil {
			log.Warn("firestore emulator flusher unavailable — using noop", zap.Error(err))
		} else {
			shardFlusher = ff
			defer ff.Close()
		}
	}

	embedLRU, err := embedcache.New(cfg.LRUCacheSize)
	if err != nil {
		return err
	}

	br := breaker.New(breaker.Settings{
		MaxRequests: cfg.BreakerMaxRequests,
		Interval:    cfg.BreakerInterval,
		Timeout:     cfg.BreakerTimeout,
	}, log)

	embedClient := embedder.New(cfg.EmbedderURLs, br, embedLRU, log)
	hot := hotstore.New(cfg.HotStoreLRUShards*10, cfg.HotStoreRingDuration)
	shardMap := shard.NewShardMap()
	engines := newConsensusStore()

	// Replay any WAL entries that survived a previous crash before Firestore could be reached.
	if err := replayWAL(ctx, cfg.WALDir, walStore, shardMap, shardFlusher, log); err != nil {
		log.Warn("wal: replay failed — continuing without replay", zap.Error(err))
	}

	redactor, err := redact.New(cfg.RedactionDictDir)
	if err != nil {
		return err
	}

	toEmbedder := make(chan apiv1.Redacted, 1024)
	toSSE := make(chan apiv1.SSEEnvelope, 1024)
	toShardCh := make(chan apiv1.EmbeddedUtterance, 4096)

	fanout := pipeline.Fanout{
		ToEmbedder:  toEmbedder,
		ToConsensus: make(chan apiv1.EmbeddedUtterance, 2048), // unused in this loop; consensus is in-process
		ToShard:     toShardCh,
		ToSSE:       toSSE,
	}
	pipe := pipeline.New(pipeline.DefaultConfig(), redactor, fanout, log)

	// SSE → hot store bridge
	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case env, ok := <-toSSE:
				if !ok {
					return
				}
				if env.MeetingID != "" {
					hot.Append(env.MeetingID, env)
				}
			}
		}
	}()

	// embedder batch loop
	go func() {
		batch := make([]apiv1.Redacted, 0, cfg.EmbedBatchSize)
		flush := time.NewTicker(cfg.EmbedFlushEvery)
		defer flush.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-flush.C:
				if len(batch) > 0 {
					flushBatch(ctx, batch, embedClient, engines, toShardCh, hot, log, br)
					batch = batch[:0]
				}
			case r, ok := <-toEmbedder:
				if !ok {
					return
				}
				batch = append(batch, r)
				if len(batch) >= cfg.EmbedBatchSize {
					flushBatch(ctx, batch, embedClient, engines, toShardCh, hot, log, br)
					batch = batch[:0]
				}
			}
		}
	}()

	// shard write router
	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case u, ok := <-toShardCh:
				if !ok {
					return
				}
				wr := shardMap.GetOrCreate(ctx, u.MeetingID, walStore, shardFlusher, log)
				wr.Submit(u)
			}
		}
	}()

	srv := server.New(server.Config{
		Addr:           cfg.HTTP.Addr,
		ReadTimeout:    cfg.HTTP.ReadTimeout,
		WriteTimeout:   cfg.HTTP.WriteTimeout,
		IdleTimeout:    cfg.HTTP.IdleTimeout,
		APIKey:         cfg.APIKey,
		AllowedOrigins: cfg.AllowedOrigins,
	}, hot, pipe, log)

	g, gctx := errgroup.WithContext(ctx)
	g.Go(func() error {
		if err := srv.Start(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			return err
		}
		return nil
	})
	g.Go(func() error {
		pipe.Run(gctx)
		return nil
	})
	g.Go(func() error {
		<-gctx.Done()
		shutCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		return srv.Shutdown(shutCtx)
	})

	return g.Wait()
}

func flushBatch(
	ctx context.Context,
	batch []apiv1.Redacted,
	ec *embedder.Client,
	engines *consensusStore,
	toShard chan<- apiv1.EmbeddedUtterance,
	hot *hotstore.Store,
	log *zap.Logger,
	br *breaker.Breaker,
) {
	texts := make([]string, len(batch))
	for i, r := range batch {
		texts[i] = r.RedactedText
	}

	vecs, err := ec.Embed(ctx, texts)
	stale := false
	if errors.Is(err, breaker.ErrBreakerOpen) {
		stale = true
		vecs = make([][]float32, len(batch))
		for i, r := range batch {
			e := engines.getOrCreate(r.MeetingID)
			if sv, ok := e.StickyVec(r.SpeakerID); ok {
				vecs[i] = sv
			}
		}
	} else if err != nil {
		log.Error("embedder: batch failed", zap.Error(err))
		return
	}

	for i, r := range batch {
		if vecs[i] == nil {
			continue
		}
		eng := engines.getOrCreate(r.MeetingID)
		score, delta := eng.Update(r.SpeakerID, vecs[i])
		drift := eng.Drift(r.SpeakerID)

		eu := apiv1.EmbeddedUtterance{Redacted: r, Vec: vecs[i], ConsensusScore: score, ConsensusDelta: delta}

		ce := apiv1.ConsensusEvent{
			MeetingID: r.MeetingID,
			SpeakerID: r.SpeakerID,
			Score:     score,
			Delta:     delta,
			Drift:     drift,
			Stale:     stale,
			Seq:       r.Seq,
		}
		hot.Append(r.MeetingID, apiv1.SSEEnvelope{
			Type:      "consensus",
			MeetingID: r.MeetingID,
			Payload:   ce,
			Seq:       r.Seq,
		})

		// emit a rule-based bridge note every 5th utterance per meeting
		if bn := engines.bridgeNote(r.MeetingID, score, delta, drift, r.SpeakerID); bn != nil {
			hot.Append(r.MeetingID, apiv1.SSEEnvelope{
				Type:      "bridge",
				MeetingID: r.MeetingID,
				Payload:   *bn,
				Seq:       r.Seq,
			})
		}

		select {
		case toShard <- eu:
		default:
		}
	}
}

// consensusStore holds per-meeting consensus engines and utterance counters for bridge throttling.
type consensusStore struct {
	mu       sync.Mutex
	engines  map[string]consensus.Engine
	counters map[string]int // utterances seen per meeting
}

func newConsensusStore() *consensusStore {
	return &consensusStore{
		engines:  make(map[string]consensus.Engine),
		counters: make(map[string]int),
	}
}

func (cs *consensusStore) getOrCreate(meetingID string) consensus.Engine {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	if e, ok := cs.engines[meetingID]; ok {
		return e
	}
	e := consensus.New(384)
	cs.engines[meetingID] = e
	return e
}

// bridgeNote increments the utterance counter and returns a rule-based BridgeNote
// every 5th utterance. Returns nil when no note should be emitted.
func (cs *consensusStore) bridgeNote(meetingID string, score, delta, drift float32, speakerID string) *apiv1.BridgeNote {
	cs.mu.Lock()
	cs.counters[meetingID]++
	n := cs.counters[meetingID]
	cs.mu.Unlock()

	if n%5 != 0 {
		return nil
	}

	var tags []string
	var note string

	switch {
	case delta < -0.15:
		tags = []string{"diverging"}
		note = "Alignment dropping — consider an explicit check-in with the group."
	case drift > 0.6:
		tags = []string{"speaker-drift"}
		note = speakerID + " has significantly shifted topic focus from their baseline."
	case score > 0.7:
		tags = []string{"high-alignment"}
		note = "Strong semantic alignment across speakers — a good moment to record decisions."
	case score > 0.4:
		tags = []string{"converging"}
		note = "Speakers are converging. Keep the current thread going."
	default:
		tags = []string{"early-stage"}
		note = "Alignment is still forming. Give speakers time to establish shared context."
	}

	return &apiv1.BridgeNote{
		MeetingID: meetingID,
		Tags:      tags,
		Note:      note,
		Ts:        time.Now(),
	}
}

// replayWAL walks the WAL directory and re-submits any surviving entries to the
// shard flusher. Entries are written to WAL only when Firestore is unavailable,
// so a non-empty WAL means a previous run crashed before flushing.
func replayWAL(ctx context.Context, walDir string, w *wal.WAL, sm *shard.ShardMap, f shard.Flusher, log *zap.Logger) error {
	entries, err := os.ReadDir(walDir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil // nothing to replay
		}
		return err
	}

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		meetingID := entry.Name()
		walPath := filepath.Join(walDir, meetingID, "wal.jsonl")
		if _, err := os.Stat(walPath); os.IsNotExist(err) {
			continue
		}

		var batch []shard.ShardEvent
		replayErr := w.Replay(meetingID, func(e wal.Entry) error {
			var se shard.ShardEvent
			if err := json.Unmarshal(e.Payload, &se); err != nil {
				log.Warn("wal: skipping unreadable entry",
					zap.String("meeting_id", meetingID), zap.Error(err))
				return nil
			}
			batch = append(batch, se)
			return nil
		})
		if replayErr != nil {
			log.Error("wal: replay scan failed", zap.String("meeting_id", meetingID), zap.Error(replayErr))
			continue
		}

		if len(batch) == 0 {
			continue
		}

		shardID := batch[0].ShardID
		if err := f.Flush(ctx, meetingID, shardID, batch); err != nil {
			log.Error("wal: replay flush failed", zap.String("meeting_id", meetingID), zap.Error(err))
		} else {
			log.Info("wal: replayed", zap.String("meeting_id", meetingID), zap.Int("events", len(batch)))
		}
		// Ensure a writer exists for ongoing shard writes.
		sm.GetOrCreate(ctx, meetingID, w, f, log)
	}
	return nil
}
