package wal

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"go.uber.org/zap"

	"github.com/kansostate/sentinel/internal/metrics"
)

// Entry is a single WAL record.
type Entry struct {
	MeetingID string          `json:"meeting_id"`
	Seq       uint64          `json:"seq"`
	Ts        time.Time       `json:"ts"`
	Payload   json.RawMessage `json:"payload"`
}

// WAL is an append-only on-disk write-ahead log per meeting, used to buffer
// shard writes during Firestore latency spikes. Entries are replayed on startup.
type WAL struct {
	dir    string
	mu     sync.Mutex
	files  map[string]*os.File
	log    *zap.Logger
}

// New creates a WAL rooted at dir. The directory is created if it doesn't exist.
func New(dir string, log *zap.Logger) (*WAL, error) {
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return nil, fmt.Errorf("wal: mkdir %s: %w", dir, err)
	}
	return &WAL{
		dir:   dir,
		files: make(map[string]*os.File),
		log:   log,
	}, nil
}

// Append writes an entry to the meeting's WAL file.
func (w *WAL) Append(e Entry) error {
	w.mu.Lock()
	defer w.mu.Unlock()

	f, err := w.fileFor(e.MeetingID)
	if err != nil {
		return err
	}

	data, err := json.Marshal(e)
	if err != nil {
		return fmt.Errorf("wal: marshal: %w", err)
	}
	data = append(data, '\n')

	if _, err := f.Write(data); err != nil {
		return fmt.Errorf("wal: write: %w", err)
	}
	metrics.WALWriteTotal.Inc()
	return nil
}

// Replay reads all entries from the meeting's WAL and calls fn for each.
// The WAL file is deleted after successful replay.
func (w *WAL) Replay(meetingID string, fn func(Entry) error) error {
	w.mu.Lock()
	// close any open handle first
	if f, ok := w.files[meetingID]; ok {
		f.Close()
		delete(w.files, meetingID)
	}
	w.mu.Unlock()

	path := w.pathFor(meetingID)
	f, err := os.Open(path)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("wal: open for replay: %w", err)
	}
	defer f.Close()

	sc := bufio.NewScanner(f)
	for sc.Scan() {
		var e Entry
		if err := json.Unmarshal(sc.Bytes(), &e); err != nil {
			w.log.Warn("wal: skipping corrupt entry", zap.Error(err))
			continue
		}
		if err := fn(e); err != nil {
			return fmt.Errorf("wal: replay fn: %w", err)
		}
		metrics.WALReplayTotal.Inc()
	}
	if err := sc.Err(); err != nil {
		return fmt.Errorf("wal: scan: %w", err)
	}

	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		w.log.Warn("wal: failed to remove after replay", zap.String("path", path), zap.Error(err))
	}
	return nil
}

// Close flushes and closes all open WAL files.
func (w *WAL) Close() {
	w.mu.Lock()
	defer w.mu.Unlock()
	for id, f := range w.files {
		if err := f.Sync(); err != nil {
			w.log.Warn("wal: sync on close", zap.String("meeting_id", id), zap.Error(err))
		}
		f.Close()
		delete(w.files, id)
	}
}

func (w *WAL) fileFor(meetingID string) (*os.File, error) {
	if f, ok := w.files[meetingID]; ok {
		return f, nil
	}
	dir := filepath.Join(w.dir, meetingID)
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return nil, fmt.Errorf("wal: mkdir meeting: %w", err)
	}
	path := w.pathFor(meetingID)
	f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o640)
	if err != nil {
		return nil, fmt.Errorf("wal: open: %w", err)
	}
	w.files[meetingID] = f
	return f, nil
}

func (w *WAL) pathFor(meetingID string) string {
	return filepath.Join(w.dir, meetingID, "wal.jsonl")
}
