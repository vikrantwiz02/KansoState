package consensus

import (
	"math"
	"sync"
)

const (
	// emaAlpha is the smoothing factor for the exponentially-weighted moving average.
	emaAlpha = float32(0.2)
	// minDim is the minimum vector dimension accepted.
	minDim = 1
)

// Engine computes meeting-level consensus from per-speaker embedding vectors.
// All methods are safe for concurrent use.
type Engine interface {
	// Update ingests a new embedding vector for the given speaker and returns
	// the updated consensus score and the delta from the previous score.
	Update(speaker string, v []float32) (score, delta float32)
	// Reference returns the current reference (centroid) vector.
	Reference() []float32
	// Drift returns the drift score for the given speaker:
	// 1 - cosine(v_speaker_recent, v_speaker_baseline).
	// A score near 0 means the speaker is consistent; near 2 means fully reversed.
	Drift(speaker string) float32
	// StickyVec returns the last known embedding vector for a speaker.
	// Used by the circuit-breaker fallback when the embedder is unavailable.
	StickyVec(speaker string) ([]float32, bool)
}

type engine struct {
	mu       sync.RWMutex
	ref      []float32       // reference vector (centroid of all speakers)
	ema      float32         // EMA-smoothed consensus score C
	speakers map[string]*speakerState
}

type speakerState struct {
	baseline []float32 // first vector seen from this speaker
	last     []float32 // most recent vector (sticky vec for breaker fallback)
}

// New creates a consensus Engine. dim is the expected vector dimension.
func New(dim int) Engine {
	return &engine{
		ref:      make([]float32, dim),
		speakers: make(map[string]*speakerState),
	}
}

// Update implements Engine.
//
// Algorithm:
//  1. Compute cosine(v_i, v_ref) for the incoming vector.
//  2. Apply EMA: ema = α·cosine + (1-α)·ema
//  3. Update the reference vector as an online mean across all speakers.
//  4. Store the incoming vector as the speaker's sticky vec.
//
// Returns C ∈ [-1, 1] and the signed delta from the previous EMA value.
func (e *engine) Update(speaker string, v []float32) (score, delta float32) {
	if len(v) == 0 {
		return e.currentScore(), 0
	}

	e.mu.Lock()
	defer e.mu.Unlock()

	// Grow ref if needed (first call or dim change)
	if len(e.ref) != len(v) {
		e.ref = make([]float32, len(v))
	}

	st := e.ensureSpeaker(speaker, v)

	cos := cosine(v, e.ref)
	prev := e.ema
	e.ema = emaAlpha*cos + (1-emaAlpha)*e.ema

	// update reference vector as online mean over all unique speaker last-vecs
	e.updateReference()

	// store sticky vec
	st.last = cloneVec(v)

	return e.ema, e.ema - prev
}

// Reference implements Engine.
func (e *engine) Reference() []float32 {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return cloneVec(e.ref)
}

// Drift implements Engine.
func (e *engine) Drift(speaker string) float32 {
	e.mu.RLock()
	defer e.mu.RUnlock()
	st, ok := e.speakers[speaker]
	if !ok || len(st.baseline) == 0 || len(st.last) == 0 {
		return 0
	}
	return 1 - cosine(st.last, st.baseline)
}

// StickyVec implements Engine.
func (e *engine) StickyVec(speaker string) ([]float32, bool) {
	e.mu.RLock()
	defer e.mu.RUnlock()
	st, ok := e.speakers[speaker]
	if !ok || len(st.last) == 0 {
		return nil, false
	}
	return cloneVec(st.last), true
}

func (e *engine) currentScore() float32 {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.ema
}

func (e *engine) ensureSpeaker(speaker string, v []float32) *speakerState {
	if st, ok := e.speakers[speaker]; ok {
		return st
	}
	st := &speakerState{baseline: cloneVec(v)}
	e.speakers[speaker] = st
	return st
}

// updateReference recomputes the reference vector as the arithmetic mean of all
// speakers' last-known vectors. Called while holding e.mu write lock.
func (e *engine) updateReference() {
	n := len(e.speakers)
	if n == 0 {
		return
	}
	dim := len(e.ref)
	for i := range e.ref {
		e.ref[i] = 0
	}
	for _, st := range e.speakers {
		if len(st.last) != dim {
			continue
		}
		for i, val := range st.last {
			e.ref[i] += val
		}
	}
	inv := float32(1) / float32(n)
	for i := range e.ref {
		e.ref[i] *= inv
	}
}

// cosine computes the cosine similarity between two vectors.
// Returns 0 if either vector is zero-length or dimensions differ.
func cosine(a, b []float32) float32 {
	if len(a) != len(b) || len(a) == 0 {
		return 0
	}
	var dot, normA, normB float64
	for i := range a {
		ai, bi := float64(a[i]), float64(b[i])
		dot += ai * bi
		normA += ai * ai
		normB += bi * bi
	}
	if normA == 0 || normB == 0 {
		return 0
	}
	c := dot / (math.Sqrt(normA) * math.Sqrt(normB))
	// clamp to [-1, 1] to guard against floating-point noise
	if c > 1 {
		c = 1
	} else if c < -1 {
		c = -1
	}
	return float32(c)
}

func cloneVec(v []float32) []float32 {
	if v == nil {
		return nil
	}
	out := make([]float32, len(v))
	copy(out, v)
	return out
}
