package consensus_test

import (
	"math"
	"math/rand"
	"testing"

	"github.com/kansostate/sentinel/internal/consensus"
	"github.com/leanovate/gopter"
	"github.com/leanovate/gopter/gen"
	"github.com/leanovate/gopter/prop"
)

const dim = 384

func randVec(rng *rand.Rand) []float32 {
	v := make([]float32, dim)
	for i := range v {
		v[i] = float32(rng.NormFloat64())
	}
	return v
}

func TestUpdate_ScoreInRange(t *testing.T) {
	e := consensus.New(dim)
	rng := rand.New(rand.NewSource(42))
	for i := 0; i < 1000; i++ {
		score, _ := e.Update("alice", randVec(rng))
		if score < -1 || score > 1 {
			t.Fatalf("score %f out of [-1,1]", score)
		}
	}
}

func TestUpdate_Idempotent_SameVector(t *testing.T) {
	e := consensus.New(dim)
	v := make([]float32, dim)
	for i := range v {
		v[i] = 1.0
	}
	s1, _ := e.Update("alice", v)
	s2, _ := e.Update("alice", v)
	// After the first update, submitting the exact same vector should converge — delta should shrink.
	if math.Abs(float64(s1-s2)) > 0.5 {
		t.Errorf("repeated identical vector should not cause large score swings: s1=%f s2=%f", s1, s2)
	}
}

func TestDrift_ZeroForNewSpeaker(t *testing.T) {
	e := consensus.New(dim)
	if d := e.Drift("unknown"); d != 0 {
		t.Errorf("drift for unknown speaker should be 0, got %f", d)
	}
}

func TestDrift_NonNegative(t *testing.T) {
	e := consensus.New(dim)
	rng := rand.New(rand.NewSource(1))
	e.Update("bob", randVec(rng))
	for i := 0; i < 50; i++ {
		e.Update("bob", randVec(rng))
		if d := e.Drift("bob"); d < -0.0001 {
			t.Errorf("drift should be non-negative, got %f", d)
		}
	}
}

func TestStickyVec_AfterUpdate(t *testing.T) {
	e := consensus.New(dim)
	v := make([]float32, dim)
	v[0] = 1
	e.Update("alice", v)
	sv, ok := e.StickyVec("alice")
	if !ok {
		t.Fatal("expected sticky vec")
	}
	if sv[0] != 1 {
		t.Errorf("sticky vec should match last submitted vec")
	}
}

func TestProperties(t *testing.T) {
	params := gopter.DefaultTestParameters()
	params.MinSuccessfulTests = 300
	properties := gopter.NewProperties(params)

	properties.Property("score always in [-1, 1]", prop.ForAll(
		func(vals []float32) bool {
			e := consensus.New(len(vals))
			score, _ := e.Update("p", vals)
			return score >= -1 && score <= 1
		},
		gen.SliceOfN(32, gen.Float32Range(-10, 10)),
	))

	properties.Property("monotone EMA: repeated identical vector converges", prop.ForAll(
		func(seed int64) bool {
			rng := rand.New(rand.NewSource(seed))
			e := consensus.New(dim)
			v := randVec(rng)
			var prev float32 = -2
			for i := 0; i < 20; i++ {
				score, _ := e.Update("p", v)
				if i > 5 && math.Abs(float64(score-prev)) > 0.3 {
					return false // EMA should be converging
				}
				prev = score
			}
			return true
		},
		gen.Int64Range(0, 1000),
	))

	properties.TestingRun(t)
}

func BenchmarkConsensus_Update(b *testing.B) {
	e := consensus.New(dim)
	rng := rand.New(rand.NewSource(99))
	vecs := make([][]float32, 1000)
	for i := range vecs {
		vecs[i] = randVec(rng)
	}
	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		e.Update("alice", vecs[i%len(vecs)])
	}
}
