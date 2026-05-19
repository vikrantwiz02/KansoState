package vclock_test

import (
	"testing"

	"github.com/kansostate/sentinel/internal/vclock"
	"github.com/leanovate/gopter"
	"github.com/leanovate/gopter/gen"
	"github.com/leanovate/gopter/prop"
)

func TestHappensBefore_Basic(t *testing.T) {
	a := vclock.New()
	b := vclock.New()

	a.Tick("alice")
	a.Tick("alice")
	b.Merge(a)
	b.Tick("bob")

	if !a.HappensBefore(b) {
		t.Fatal("a should happen before b")
	}
	if b.HappensBefore(a) {
		t.Fatal("b should not happen before a")
	}
}

func TestConcurrent(t *testing.T) {
	a := vclock.New()
	b := vclock.New()
	a.Tick("alice")
	b.Tick("bob")

	if !a.Concurrent(b) {
		t.Fatal("a and b should be concurrent")
	}
}

func TestMerge_Idempotent(t *testing.T) {
	a := vclock.New()
	a.Tick("alice")
	a.Tick("alice")

	b := a.Clone()
	b.Merge(a)
	b.Merge(a)

	if a.TopoRank() != b.TopoRank() {
		t.Fatal("merge should be idempotent")
	}
}

func TestProperties(t *testing.T) {
	params := gopter.DefaultTestParameters()
	params.MinSuccessfulTests = 500
	properties := gopter.NewProperties(params)

	properties.Property("reflexivity: clock does not happen-before itself", prop.ForAll(
		func(ticks uint8) bool {
			c := vclock.New()
			for i := uint8(0); i < ticks; i++ {
				c.Tick("p")
			}
			return !c.HappensBefore(c)
		},
		gen.UInt8Range(0, 20),
	))

	properties.Property("merge commutativity: A.Merge(B) == B.Merge(A) in topo rank", prop.ForAll(
		func(ta, tb uint8) bool {
			a := vclock.New()
			b := vclock.New()
			for i := uint8(0); i < ta; i++ {
				a.Tick("alice")
			}
			for i := uint8(0); i < tb; i++ {
				b.Tick("bob")
			}
			ab := a.Clone()
			ab.Merge(b)
			ba := b.Clone()
			ba.Merge(a)
			return ab.TopoRank() == ba.TopoRank()
		},
		gen.UInt8Range(0, 20),
		gen.UInt8Range(0, 20),
	))

	properties.Property("antisymmetry: if A < B then !(B < A)", prop.ForAll(
		func(ta, tb uint8) bool {
			a := vclock.New()
			b := vclock.New()
			for i := uint8(0); i < ta; i++ {
				a.Tick("p")
			}
			b.Merge(a)
			for i := uint8(0); i < tb; i++ {
				b.Tick("p")
			}
			if ta == 0 && tb == 0 {
				return true // equal clocks: neither < the other
			}
			if tb == 0 {
				return true // equal
			}
			return a.HappensBefore(b) && !b.HappensBefore(a)
		},
		gen.UInt8Range(0, 10),
		gen.UInt8Range(1, 10),
	))

	properties.TestingRun(t)
}
