package redact_test

import (
	"strings"
	"testing"

	"github.com/kansostate/sentinel/internal/redact"
	"github.com/kansostate/sentinel/pkg/apiv1"
)

func newTestRedactor(t *testing.T) *redact.Redactor {
	t.Helper()
	r, err := redact.New("dictionaries")
	if err != nil {
		t.Fatalf("new redactor: %v", err)
	}
	return r
}

func TestRedact_Email(t *testing.T) {
	r := newTestRedactor(t)
	u := apiv1.Utterance{MeetingID: "m1", SpeakerID: "s1", Text: "email me at user@example.com please"}
	out, err := r.Redact(u)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(out.RedactedText, "user@example.com") {
		t.Errorf("email not redacted: %q", out.RedactedText)
	}
	if !strings.Contains(out.RedactedText, "[EMAIL_1]") {
		t.Errorf("placeholder missing: %q", out.RedactedText)
	}
}

func TestRedact_Card_Luhn(t *testing.T) {
	r := newTestRedactor(t)
	// valid Luhn: 4532015112830366
	u := apiv1.Utterance{MeetingID: "m1", Text: "card 4532015112830366 expired"}
	out, err := r.Redact(u)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(out.RedactedText, "4532015112830366") {
		t.Errorf("card not redacted: %q", out.RedactedText)
	}
}

func TestRedact_Card_InvalidLuhn_NotRedacted(t *testing.T) {
	r := newTestRedactor(t)
	// fails Luhn check
	u := apiv1.Utterance{MeetingID: "m1", Text: "number 1234567890123456 here"}
	out, err := r.Redact(u)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out.RedactedText, "1234567890123456") {
		t.Errorf("invalid Luhn card should NOT be redacted: %q", out.RedactedText)
	}
}

func TestRedact_IBAN(t *testing.T) {
	r := newTestRedactor(t)
	// valid GB IBAN
	u := apiv1.Utterance{MeetingID: "m1", Text: "send to GB82WEST12345698765432 thanks"}
	out, err := r.Redact(u)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(out.RedactedText, "GB82WEST12345698765432") {
		t.Errorf("IBAN not redacted: %q", out.RedactedText)
	}
}

func TestRedact_Keyword(t *testing.T) {
	r := newTestRedactor(t)
	u := apiv1.Utterance{MeetingID: "m1", Text: "the password is hunter2"}
	out, err := r.Redact(u)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(out.RedactedText, "password") {
		t.Errorf("keyword not redacted: %q", out.RedactedText)
	}
}

func TestRedact_Allowlist(t *testing.T) {
	r := newTestRedactor(t)
	r.SetAllowlist("m2", []string{"user@example.com"})
	u := apiv1.Utterance{MeetingID: "m2", Text: "email user@example.com is fine"}
	out, err := r.Redact(u)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out.RedactedText, "user@example.com") {
		t.Errorf("allowlisted value should not be redacted: %q", out.RedactedText)
	}
}

func BenchmarkRedact_200msg(b *testing.B) {
	r, _ := redact.New("dictionaries")
	u := apiv1.Utterance{
		MeetingID: "bench",
		Text:      "please send invoice to finance@corp.example.com, card 4532015112830366, ref GB82WEST12345698765432",
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, err := r.Redact(u); err != nil {
			b.Fatal(err)
		}
	}
}

func FuzzRedact(f *testing.F) {
	f.Add("hello world user@test.com")
	f.Add("4532015112830366 pay now")
	f.Add("")
	r, _ := redact.New("dictionaries")
	f.Fuzz(func(t *testing.T, text string) {
		u := apiv1.Utterance{MeetingID: "fuzz", Text: text}
		out, err := r.Redact(u)
		if err != nil {
			t.Fatal(err)
		}
		// invariant: redacted text must never be longer than input + placeholder overhead
		if len(out.RedactedText) > len(text)+len(out.Redactions)*32 {
			t.Errorf("redacted text unexpectedly long")
		}
	})
}
