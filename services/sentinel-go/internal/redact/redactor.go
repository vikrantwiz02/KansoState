package redact

import (
	"crypto/sha256"
	"fmt"
	"sort"
	"sync"
	"sync/atomic"
	"unicode"

	"golang.org/x/text/unicode/norm"

	"github.com/kansostate/sentinel/pkg/apiv1"
)

// Redactor applies PII redaction to utterance text.
// Safe for concurrent use; one pooled byte buffer per call via sync.Pool.
type Redactor struct {
	ac          *ahoCorasickMatcher
	regexer     *regexMatcher
	allowlists  sync.Map // meetingID → map[string]struct{}
	counters    sync.Map // meetingID → *placeholderCounters
}

type placeholderCounters struct {
	mu     sync.Mutex
	counts map[apiv1.TokenKind]*uint64
}

func (pc *placeholderCounters) next(kind apiv1.TokenKind) uint64 {
	pc.mu.Lock()
	if _, ok := pc.counts[kind]; !ok {
		var zero uint64
		pc.counts[kind] = &zero
	}
	n := atomic.AddUint64(pc.counts[kind], 1)
	pc.mu.Unlock()
	return n
}

// New creates a Redactor loading dictionaries from dictDir.
func New(dictDir string) (*Redactor, error) {
	ac, err := newAhoCorasickMatcher(dictDir)
	if err != nil {
		return nil, fmt.Errorf("redact: loading AC matcher: %w", err)
	}
	return &Redactor{
		ac:      ac,
		regexer: newRegexMatcher(),
	}, nil
}

// SetAllowlist registers per-meeting tokens that must NOT be redacted.
func (r *Redactor) SetAllowlist(meetingID string, tokens []string) {
	m := make(map[string]struct{}, len(tokens))
	for _, t := range tokens {
		m[t] = struct{}{}
	}
	r.allowlists.Store(meetingID, m)
}

// Redact returns a Redacted utterance. The input utterance is not modified.
func (r *Redactor) Redact(u apiv1.Utterance) (apiv1.Redacted, error) {
	// 1. Normalize
	normalized := norm.NFKC.String(u.Text)
	normalized = stripZeroWidth(normalized)

	// 2. Collect all candidate spans
	spans := r.regexer.Find(normalized)
	acSpans := r.ac.Find(normalized)
	spans = append(spans, acSpans...)

	// 3. Filter allowlisted values
	if al, ok := r.allowlists.Load(u.MeetingID); ok {
		allowlist := al.(map[string]struct{})
		filtered := spans[:0]
		for _, s := range spans {
			orig := normalized[s.Start:s.End]
			if _, skip := allowlist[orig]; !skip {
				filtered = append(filtered, s)
			}
		}
		spans = filtered
	}

	// 4. Resolve overlaps: higher-precision kind wins, then longer, then earlier
	spans = resolveOverlaps(spans)

	// 5. Assign placeholders and build redacted text
	salt := sha256.Sum256([]byte(u.MeetingID))
	pc := r.countersFor(u.MeetingID)

	sort.Slice(spans, func(i, j int) bool { return spans[i].Start < spans[j].Start })

	tokens := make([]apiv1.Token, 0, len(spans))
	buf := make([]byte, 0, len(normalized)+64)
	prev := 0

	for _, s := range spans {
		n := pc.next(s.Kind)
		placeholder := fmt.Sprintf("[%s_%d]", s.Kind, n)

		original := normalized[s.Start:s.End]
		hashInput := append([]byte(original), salt[:]...)
		hash := sha256.Sum256(hashInput)

		tokens = append(tokens, apiv1.Token{
			Kind:        s.Kind,
			Placeholder: placeholder,
			Start:       s.Start,
			End:         s.End,
			Hash:        hash,
		})

		buf = append(buf, normalized[prev:s.Start]...)
		buf = append(buf, placeholder...)
		prev = s.End
	}
	buf = append(buf, normalized[prev:]...)

	return apiv1.Redacted{
		Utterance:    u,
		Redactions:   tokens,
		RedactedText: string(buf),
	}, nil
}

func (r *Redactor) countersFor(meetingID string) *placeholderCounters {
	v, _ := r.counters.LoadOrStore(meetingID, &placeholderCounters{
		counts: make(map[apiv1.TokenKind]*uint64),
	})
	return v.(*placeholderCounters)
}

// kindPriority returns the precedence for overlap resolution (lower = higher priority).
func kindPriority(k apiv1.TokenKind) int {
	switch k {
	case apiv1.TokenKindCard:
		return 0
	case apiv1.TokenKindPhone, apiv1.TokenKindIBAN, apiv1.TokenKindMyNumber:
		return 1
	case apiv1.TokenKindEmail:
		return 2
	case apiv1.TokenKindKeyword:
		return 3
	case apiv1.TokenKindName:
		return 4
	}
	return 99
}

type span struct {
	Kind  apiv1.TokenKind
	Start int
	End   int
}

func resolveOverlaps(spans []span) []span {
	if len(spans) == 0 {
		return spans
	}
	sort.Slice(spans, func(i, j int) bool {
		si, sj := spans[i], spans[j]
		if si.Start != sj.Start {
			return si.Start < sj.Start
		}
		// tie-break: higher priority kind first
		return kindPriority(si.Kind) < kindPriority(sj.Kind)
	})

	out := spans[:0]
	for _, s := range spans {
		if len(out) == 0 {
			out = append(out, s)
			continue
		}
		last := &out[len(out)-1]
		if s.Start < last.End {
			// overlap: keep whichever wins
			if kindPriority(s.Kind) < kindPriority(last.Kind) {
				*last = s
			} else if kindPriority(s.Kind) == kindPriority(last.Kind) && (s.End-s.Start) > (last.End-last.Start) {
				*last = s
			}
			// else keep existing
		} else {
			out = append(out, s)
		}
	}
	return out
}

func stripZeroWidth(s string) string {
	out := make([]rune, 0, len(s))
	for _, r := range s {
		if !isZeroWidth(r) {
			out = append(out, r)
		}
	}
	return string(out)
}

func isZeroWidth(r rune) bool {
	switch r {
	case 0x200b, 0x200c, 0x200d, 0xfeff, 0x00ad:
		return true
	}
	return unicode.Is(unicode.Cf, r)
}
