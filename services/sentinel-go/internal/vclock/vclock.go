package vclock

import (
	"crypto/sha256"
	"encoding/binary"
	"sort"
)

// Clock is a logical vector clock: participant ID → monotonic counter.
type Clock map[string]uint64

// New returns an empty clock.
func New() Clock {
	return make(Clock)
}

// Clone returns a deep copy of the clock.
func (c Clock) Clone() Clock {
	out := make(Clock, len(c))
	for k, v := range c {
		out[k] = v
	}
	return out
}

// Tick increments the local participant's counter.
func (c Clock) Tick(participantID string) {
	c[participantID]++
}

// Merge sets each key to the maximum of the two clocks (in-place).
func (c Clock) Merge(other Clock) {
	for k, v := range other {
		if v > c[k] {
			c[k] = v
		}
	}
}

// HappensBefore returns true if c strictly happened before other.
// c < other iff ∀k: c[k] ≤ other[k] ∧ ∃k: c[k] < other[k].
func (c Clock) HappensBefore(other Clock) bool {
	// union of all keys
	keys := unionKeys(c, other)
	atLeastOneLess := false
	for _, k := range keys {
		if c[k] > other[k] {
			return false
		}
		if c[k] < other[k] {
			atLeastOneLess = true
		}
	}
	return atLeastOneLess
}

// Concurrent returns true if neither clock happens-before the other.
func (c Clock) Concurrent(other Clock) bool {
	return !c.HappensBefore(other) && !other.HappensBefore(c)
}

// TopoRank returns a deterministic integer rank derived from the sum of all
// counter values, suitable as the primary sort key for total ordering.
func (c Clock) TopoRank() uint64 {
	var sum uint64
	for _, v := range c {
		sum += v
	}
	return sum
}

// Hash returns a deterministic 8-byte fingerprint of the clock state.
// Used as the final tie-break in total ordering (sha256-based).
func (c Clock) Hash() uint64 {
	keys := make([]string, 0, len(c))
	for k := range c {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	h := sha256.New()
	for _, k := range keys {
		h.Write([]byte(k))
		var buf [8]byte
		binary.BigEndian.PutUint64(buf[:], c[k])
		h.Write(buf[:])
	}
	sum := h.Sum(nil)
	return binary.BigEndian.Uint64(sum[:8])
}

func unionKeys(a, b Clock) []string {
	seen := make(map[string]struct{}, len(a)+len(b))
	for k := range a {
		seen[k] = struct{}{}
	}
	for k := range b {
		seen[k] = struct{}{}
	}
	out := make([]string, 0, len(seen))
	for k := range seen {
		out = append(out, k)
	}
	return out
}
