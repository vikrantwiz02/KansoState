package redact

import (
	"bufio"
	"os"
	"path/filepath"
	"strings"

	"github.com/cloudflare/ahocorasick"
	"github.com/kansostate/sentinel/pkg/apiv1"
)

// ahoCorasickMatcher finds name and keyword PII using Aho-Corasick multi-pattern search.
type ahoCorasickMatcher struct {
	nameMatcher    *ahocorasick.Matcher
	namePatterns   []string
	keywordMatcher *ahocorasick.Matcher
	keywordPatterns []string
}

// salutations is a small set of pronouns/titles used to gate name matches.
var salutations = map[string]struct{}{
	"mr": {}, "mrs": {}, "ms": {}, "dr": {}, "prof": {},
	"he": {}, "she": {}, "they": {}, "his": {}, "her": {}, "their": {},
	"mr.": {}, "mrs.": {}, "ms.": {}, "dr.": {},
}

func newAhoCorasickMatcher(dictDir string) (*ahoCorasickMatcher, error) {
	names, err := loadDict(filepath.Join(dictDir, "names.txt"))
	if err != nil {
		return nil, err
	}
	keywords, err := loadDict(filepath.Join(dictDir, "keywords.txt"))
	if err != nil {
		return nil, err
	}

	namePats := make([][]byte, len(names))
	for i, n := range names {
		namePats[i] = []byte(strings.ToLower(n))
	}
	kwPats := make([][]byte, len(keywords))
	for i, k := range keywords {
		kwPats[i] = []byte(strings.ToLower(k))
	}

	m := &ahoCorasickMatcher{
		namePatterns:    names,
		keywordPatterns: keywords,
	}
	if len(namePats) > 0 {
		m.nameMatcher = ahocorasick.NewStringMatcher(names)
	}
	if len(kwPats) > 0 {
		m.keywordMatcher = ahocorasick.NewStringMatcher(keywords)
	}
	return m, nil
}

func (a *ahoCorasickMatcher) Find(text string) []span {
	lower := strings.ToLower(text)
	words := tokenizeWords(lower)
	var spans []span

	// keywords always win — no salutation window required
	if a.keywordMatcher != nil {
		for _, hit := range a.keywordMatcher.Match([]byte(lower)) {
			pat := a.keywordPatterns[hit]
			idx := strings.Index(lower, pat)
			if idx >= 0 {
				spans = append(spans, span{
					Kind:  apiv1.TokenKindKeyword,
					Start: idx,
					End:   idx + len(pat),
				})
			}
		}
	}

	// names require a salutation or pronoun within a 4-token window
	if a.nameMatcher != nil {
		for _, hit := range a.nameMatcher.Match([]byte(lower)) {
			pat := a.namePatterns[hit]
			idx := strings.Index(lower, pat)
			if idx < 0 {
				continue
			}
			if hasSalutationNear(words, pat, 4) {
				spans = append(spans, span{
					Kind:  apiv1.TokenKindName,
					Start: idx,
					End:   idx + len(pat),
				})
			}
		}
	}

	return spans
}

func hasSalutationNear(words []string, name string, window int) bool {
	for i, w := range words {
		if w == name {
			start := i - window
			if start < 0 {
				start = 0
			}
			end := i + window + 1
			if end > len(words) {
				end = len(words)
			}
			for _, nearby := range words[start:end] {
				if _, ok := salutations[nearby]; ok {
					return true
				}
			}
		}
	}
	return false
}

func tokenizeWords(s string) []string {
	return strings.FieldsFunc(s, func(r rune) bool {
		return r == ' ' || r == '\t' || r == '\n' || r == ',' || r == '.' || r == ';'
	})
}

func loadDict(path string) ([]string, error) {
	f, err := os.Open(path)
	if os.IsNotExist(err) {
		return nil, nil // optional dict files
	}
	if err != nil {
		return nil, err
	}
	defer f.Close()

	var lines []string
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line != "" && !strings.HasPrefix(line, "#") {
			lines = append(lines, strings.ToLower(line))
		}
	}
	return lines, sc.Err()
}
