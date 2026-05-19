package hotstore

import (
	"sync"
	"time"

	lru "github.com/hashicorp/golang-lru/v2"

	"github.com/kansostate/sentinel/pkg/apiv1"
)

// Store is the live read path for the dashboard.
// It maintains a 60-second ring buffer and a per-meeting shard LRU.
// Firestore is never read for live meetings — all reads go through here.
type Store struct {
	mu       sync.RWMutex
	meetings map[string]*meetingStore
	lruCap   int
	ringDur  time.Duration
}

type meetingStore struct {
	mu        sync.Mutex
	ring      []timedEvent
	subs      []chan apiv1.SSEEnvelope
	consensus float32
	stale     bool
	vclock    apiv1.VClock
}

type timedEvent struct {
	ts  time.Time
	env apiv1.SSEEnvelope
}

// New creates a Store. lruCap is the max number of meetings cached,
// ringDur is how far back the ring buffer retains events.
func New(lruCap int, ringDur time.Duration) *Store {
	return &Store{
		meetings: make(map[string]*meetingStore),
		lruCap:   lruCap,
		ringDur:  ringDur,
	}
}

// Append stores an event for a meeting and fans it out to active subscribers.
func (s *Store) Append(meetingID string, env apiv1.SSEEnvelope) {
	ms := s.ensureMeeting(meetingID)
	ms.mu.Lock()

	// evict expired ring entries
	now := time.Now()
	cutoff := now.Add(-s.ringDur)
	filtered := ms.ring[:0]
	for _, e := range ms.ring {
		if e.ts.After(cutoff) {
			filtered = append(filtered, e)
		}
	}
	ms.ring = append(filtered, timedEvent{ts: now, env: env})

	// update consensus state if this is a consensus event
	if env.Type == "consensus" {
		if ce, ok := env.Payload.(apiv1.ConsensusEvent); ok {
			ms.consensus = ce.Score
			ms.stale = ce.Stale
		}
	}

	// fan out to subscribers (non-blocking per-subscriber drop)
	for _, ch := range ms.subs {
		select {
		case ch <- env:
		default:
		}
	}
	ms.mu.Unlock()
}

// Hydrate returns a snapshot of the meeting's current state.
func (s *Store) Hydrate(meetingID string) apiv1.MeetingSnapshot {
	ms := s.ensureMeeting(meetingID)
	ms.mu.Lock()
	defer ms.mu.Unlock()

	events := make([]apiv1.SSEEnvelope, len(ms.ring))
	for i, e := range ms.ring {
		events[i] = e.env
	}
	return apiv1.MeetingSnapshot{
		MeetingID:      meetingID,
		Events:         events,
		ConsensusScore: ms.consensus,
		Stale:          ms.stale,
	}
}

// Subscribe returns a channel that receives all future events for the meeting.
// The caller must call the returned cancel func to unsubscribe.
func (s *Store) Subscribe(meetingID string) (<-chan apiv1.SSEEnvelope, func()) {
	ms := s.ensureMeeting(meetingID)
	ch := make(chan apiv1.SSEEnvelope, 1024)
	ms.mu.Lock()
	ms.subs = append(ms.subs, ch)
	ms.mu.Unlock()

	cancel := func() {
		ms.mu.Lock()
		out := ms.subs[:0]
		for _, c := range ms.subs {
			if c != ch {
				out = append(out, c)
			}
		}
		ms.subs = out
		ms.mu.Unlock()
		close(ch)
	}
	return ch, cancel
}

func (s *Store) ensureMeeting(meetingID string) *meetingStore {
	s.mu.Lock()
	defer s.mu.Unlock()
	if ms, ok := s.meetings[meetingID]; ok {
		return ms
	}
	ms := &meetingStore{
		ring:   make([]timedEvent, 0, 256),
		vclock: make(apiv1.VClock),
	}
	s.meetings[meetingID] = ms

	// evict oldest meeting if over cap
	if len(s.meetings) > s.lruCap {
		var oldest string
		for k := range s.meetings {
			if oldest == "" || k < oldest {
				oldest = k
			}
		}
		delete(s.meetings, oldest)
	}
	return ms
}

// ListMeetings returns IDs of meetings that have at least one event in their ring buffer.
func (s *Store) ListMeetings() []string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	ids := make([]string, 0, len(s.meetings))
	for id, ms := range s.meetings {
		ms.mu.Lock()
		active := len(ms.ring) > 0
		ms.mu.Unlock()
		if active {
			ids = append(ids, id)
		}
	}
	return ids
}

// ShardLRU wraps hashicorp/golang-lru for per-meeting shard metadata.
type ShardLRU struct {
	lru *lru.Cache[string, interface{}]
}

func NewShardLRU(cap int) (*ShardLRU, error) {
	l, err := lru.New[string, interface{}](cap)
	if err != nil {
		return nil, err
	}
	return &ShardLRU{lru: l}, nil
}

func (sl *ShardLRU) Get(key string) (interface{}, bool) {
	return sl.lru.Get(key)
}

func (sl *ShardLRU) Put(key string, val interface{}) {
	sl.lru.Add(key, val)
}
