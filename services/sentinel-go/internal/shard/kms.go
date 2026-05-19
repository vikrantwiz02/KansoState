package shard

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"io"
	"sync"

	"cloud.google.com/go/storage"
	"go.uber.org/zap"
	"google.golang.org/api/option"
)

// RedactionEntry is a single placeholder-to-hash mapping stored in the redaction map.
type RedactionEntry struct {
	Placeholder string `json:"placeholder"`
	Kind        string `json:"kind"`
	Hash        string `json:"hash"` // hex-encoded sha256 of original + salt
	Start       int    `json:"start"`
	End         int    `json:"end"`
}

// RedactionMap holds the per-meeting mapping needed to reverse redaction (auditors only).
// It is AES-256-GCM encrypted with a meeting-scoped DEK before being written to GCS.
type RedactionMap struct {
	MeetingID string           `json:"meeting_id"`
	Entries   []RedactionEntry `json:"entries"`
}

// RedactionMapStore encrypts and persists redaction maps to GCS.
// The DEK is generated per meeting; in production the DEK is itself encrypted
// with a KMS KEK (envelope encryption). In dev/emulator mode, the raw DEK is used.
type RedactionMapStore struct {
	bucket    *storage.BucketHandle
	kmsKeyID  string // projects/.../cryptoKeys/redaction — empty in dev
	mu        sync.Mutex
	deks      map[string][]byte // meetingID → DEK (in memory only)
	log       *zap.Logger
}

// NewRedactionMapStore creates a store backed by the given GCS bucket.
// kmsKeyID may be empty for dev/test (raw AES-256 DEK, no KMS wrapping).
func NewRedactionMapStore(ctx context.Context, bucketName, kmsKeyID string, log *zap.Logger, opts ...option.ClientOption) (*RedactionMapStore, error) {
	client, err := storage.NewClient(ctx, opts...)
	if err != nil {
		return nil, fmt.Errorf("redaction map store: gcs client: %w", err)
	}
	return &RedactionMapStore{
		bucket:   client.Bucket(bucketName),
		kmsKeyID: kmsKeyID,
		deks:     make(map[string][]byte),
		log:      log,
	}, nil
}

// Persist encrypts rm and writes it to GCS at redaction-maps/{meetingID}/map.enc.
func (s *RedactionMapStore) Persist(ctx context.Context, rm RedactionMap) error {
	plaintext, err := json.Marshal(rm)
	if err != nil {
		return fmt.Errorf("redaction map: marshal: %w", err)
	}

	dek, err := s.dekFor(rm.MeetingID)
	if err != nil {
		return err
	}

	ciphertext, err := aesGCMEncrypt(dek, plaintext)
	if err != nil {
		return fmt.Errorf("redaction map: encrypt: %w", err)
	}

	obj := s.bucket.Object(fmt.Sprintf("redaction-maps/%s/map.enc", rm.MeetingID))
	w := obj.NewWriter(ctx)
	if s.kmsKeyID != "" {
		w.KMSKeyName = s.kmsKeyID
	}
	if _, err := w.Write(ciphertext); err != nil {
		w.Close()
		return fmt.Errorf("redaction map: gcs write: %w", err)
	}
	if err := w.Close(); err != nil {
		return fmt.Errorf("redaction map: gcs close: %w", err)
	}
	s.log.Debug("redaction map persisted",
		zap.String("meeting_id", rm.MeetingID),
		zap.Int("entries", len(rm.Entries)),
	)
	return nil
}

// dekFor returns the DEK for a meeting, generating one on first call.
func (s *RedactionMapStore) dekFor(meetingID string) ([]byte, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if dek, ok := s.deks[meetingID]; ok {
		return dek, nil
	}
	dek := make([]byte, 32) // AES-256
	if _, err := io.ReadFull(rand.Reader, dek); err != nil {
		return nil, fmt.Errorf("redaction map: generate DEK: %w", err)
	}
	s.deks[meetingID] = dek
	return dek, nil
}

// aesGCMEncrypt encrypts plaintext with AES-256-GCM, prepending the 12-byte nonce.
func aesGCMEncrypt(key, plaintext []byte) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, err
	}
	// nonce || ciphertext
	return gcm.Seal(nonce, nonce, plaintext, nil), nil
}

