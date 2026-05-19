package vclock

import "sync"

// ClockStore manages per-meeting vector clocks with concurrent access.
type ClockStore struct {
	mu     sync.RWMutex
	clocks map[string]Clock
}

func NewClockStore() *ClockStore {
	return &ClockStore{clocks: make(map[string]Clock)}
}

// GetOrCreate returns the clock for meetingID, creating one if it doesn't exist.
func (s *ClockStore) GetOrCreate(meetingID string) Clock {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.clocks[meetingID]; !ok {
		s.clocks[meetingID] = New()
	}
	return s.clocks[meetingID]
}

// Delete removes the clock for meetingID.
func (s *ClockStore) Delete(meetingID string) {
	s.mu.Lock()
	delete(s.clocks, meetingID)
	s.mu.Unlock()
}
