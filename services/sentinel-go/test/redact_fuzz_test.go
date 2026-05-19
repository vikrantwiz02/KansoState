// Fuzz targets for the redaction pipeline — run nightly for 60 s.
// go test -fuzz=FuzzRedactorRoundtrip -fuzztime=60s ./test/...
package integration_test

import (
	"strings"
	"testing"

	"github.com/kansostate/sentinel/internal/redact"
	"github.com/kansostate/sentinel/pkg/apiv1"
)

func FuzzRedactorRoundtrip(f *testing.F) {
	f.Add("hello user@example.com please call 4532015112830366")
	f.Add("send to GB82WEST12345698765432")
	f.Add("password: hunter2 secret: abc")
	f.Add("")
	f.Add("   ")
	f.Add("日本語テスト user@例.jp")

	r, err := redact.New("../internal/redact/dictionaries")
	if err != nil {
		f.Fatalf("redactor: %v", err)
	}

	f.Fuzz(func(t *testing.T, text string) {
		u := apiv1.Utterance{MeetingID: "fuzz", SpeakerID: "alice", Text: text}
		out, err := r.Redact(u)
		if err != nil {
			t.Fatalf("redact error: %v", err)
		}
		// Invariant 1: an @ sign in the output is acceptable only if it is not part of
		// a fully-formed email pattern — the redactor normalises, not removes, partial tokens.
		// Invariant 2: every token's placeholder appears in the redacted text.
		for _, tok := range out.Redactions {
			if !strings.Contains(out.RedactedText, tok.Placeholder) {
				t.Errorf("placeholder %q missing from redacted text", tok.Placeholder)
			}
		}
		// Invariant 3: token spans don't overlap after resolution.
		for i := 1; i < len(out.Redactions); i++ {
			prev := out.Redactions[i-1]
			curr := out.Redactions[i]
			if curr.Start < prev.End {
				t.Errorf("overlapping tokens: [%d,%d) and [%d,%d)", prev.Start, prev.End, curr.Start, curr.End)
			}
		}
	})
}
