package redact

import (
	"regexp"
	"strconv"
	"strings"
	"unicode"

	"github.com/kansostate/sentinel/pkg/apiv1"
)

// regexMatcher applies regex-based PII detection with Luhn and checksum gates.
type regexMatcher struct {
	emailRe    *regexp.Regexp
	cardRe     *regexp.Regexp
	ibanRe     *regexp.Regexp
	myNumberRe *regexp.Regexp
	phoneRe    *regexp.Regexp
}

func newRegexMatcher() *regexMatcher {
	return &regexMatcher{
		// RFC 5322 simplified — practical subset
		emailRe: regexp.MustCompile(`(?i)[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}`),
		// Card: 13-19 digits, optionally space/dash separated groups
		cardRe: regexp.MustCompile(`\b(?:\d[ \-]?){13,18}\d\b`),
		// IBAN: country code + 2 check digits + up to 30 alphanumerics
		ibanRe: regexp.MustCompile(`\b[A-Z]{2}\d{2}[A-Z0-9]{4,30}\b`),
		// JP MyNumber: exactly 12 digits
		myNumberRe: regexp.MustCompile(`\b\d{12}\b`),
		// Phone: international E.164-ish pattern (rough match, validated below)
		phoneRe: regexp.MustCompile(`(?:\+\d{1,3}[\s.\-]?)?\(?\d{2,4}\)?[\s.\-]?\d{3,4}[\s.\-]?\d{3,4}`),
	}
}

func (rm *regexMatcher) Find(text string) []span {
	lower := strings.ToLower(text)
	var spans []span

	for _, loc := range rm.emailRe.FindAllStringIndex(lower, -1) {
		spans = append(spans, span{Kind: apiv1.TokenKindEmail, Start: loc[0], End: loc[1]})
	}

	for _, loc := range rm.cardRe.FindAllStringIndex(text, -1) {
		digits := extractDigits(text[loc[0]:loc[1]])
		if luhn(digits) {
			spans = append(spans, span{Kind: apiv1.TokenKindCard, Start: loc[0], End: loc[1]})
		}
	}

	for _, loc := range rm.ibanRe.FindAllStringIndex(text, -1) {
		candidate := text[loc[0]:loc[1]]
		if ibanValid(candidate) {
			spans = append(spans, span{Kind: apiv1.TokenKindIBAN, Start: loc[0], End: loc[1]})
		}
	}

	for _, loc := range rm.myNumberRe.FindAllStringIndex(text, -1) {
		digits := text[loc[0]:loc[1]]
		if myNumberChecksum(digits) {
			spans = append(spans, span{Kind: apiv1.TokenKindMyNumber, Start: loc[0], End: loc[1]})
		}
	}

	for _, loc := range rm.phoneRe.FindAllStringIndex(text, -1) {
		// Skip matches that are embedded in a longer unbroken digit string
		// (e.g. a 16-digit card that failed Luhn should not match as a phone).
		if loc[0] > 0 && unicode.IsDigit(rune(text[loc[0]-1])) {
			continue
		}
		if loc[1] < len(text) && unicode.IsDigit(rune(text[loc[1]])) {
			continue
		}
		digits := extractDigits(text[loc[0]:loc[1]])
		if len(digits) >= 7 && len(digits) <= 15 {
			spans = append(spans, span{Kind: apiv1.TokenKindPhone, Start: loc[0], End: loc[1]})
		}
	}

	return spans
}

func extractDigits(s string) string {
	var b strings.Builder
	for _, r := range s {
		if unicode.IsDigit(r) {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// luhn validates a digit string using the Luhn algorithm.
func luhn(digits string) bool {
	if len(digits) < 13 || len(digits) > 19 {
		return false
	}
	sum := 0
	double := false
	for i := len(digits) - 1; i >= 0; i-- {
		d := int(digits[i] - '0')
		if double {
			d *= 2
			if d > 9 {
				d -= 9
			}
		}
		sum += d
		double = !double
	}
	return sum%10 == 0
}

// ibanValid applies MOD-97 check to an IBAN string.
func ibanValid(iban string) bool {
	if len(iban) < 5 || len(iban) > 34 {
		return false
	}
	// rearrange: move first 4 chars to end
	rearranged := iban[4:] + iban[:4]
	// convert letters to digits: A=10 … Z=35
	var numeric strings.Builder
	for _, r := range strings.ToUpper(rearranged) {
		if r >= 'A' && r <= 'Z' {
			numeric.WriteString(strconv.Itoa(int(r-'A') + 10))
		} else if r >= '0' && r <= '9' {
			numeric.WriteRune(r)
		} else {
			return false
		}
	}
	// compute mod 97 on large number via chunking
	num := numeric.String()
	remainder := 0
	for i := 0; i < len(num); i += 9 {
		end := i + 9
		if end > len(num) {
			end = len(num)
		}
		chunk, err := strconv.Atoi(strconv.Itoa(remainder) + num[i:end])
		if err != nil {
			return false
		}
		remainder = chunk % 97
	}
	return remainder == 1
}

// myNumberChecksum validates a 12-digit JP My Number via its check digit algorithm.
func myNumberChecksum(digits string) bool {
	if len(digits) != 12 {
		return false
	}
	weights := []int{6, 5, 4, 3, 2, 7, 6, 5, 4, 3, 2}
	sum := 0
	for i := 0; i < 11; i++ {
		d := int(digits[i] - '0')
		sum += d * weights[i]
	}
	check := 11 - (sum % 11)
	if check >= 10 {
		check = 0
	}
	return int(digits[11]-'0') == check
}
