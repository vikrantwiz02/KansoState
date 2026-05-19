// Package finalize implements a Cloud Function that streams completed meeting
// shards from Firestore to BigQuery. Triggered by a write to
// meetings/{meetingId}/control/finalized.
package finalize

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"time"

	"cloud.google.com/go/bigquery"
	"cloud.google.com/go/firestore"
)

// FirestoreEvent is the payload delivered by the Firestore trigger.
type FirestoreEvent struct {
	OldValue   FirestoreValue `json:"oldValue"`
	Value      FirestoreValue `json:"value"`
	UpdateMask struct {
		FieldPaths []string `json:"fieldPaths"`
	} `json:"updateMask"`
}

// FirestoreValue is a Firestore document snapshot.
type FirestoreValue struct {
	Name       string                 `json:"name"`
	Fields     map[string]interface{} `json:"fields"`
	CreateTime time.Time              `json:"createTime"`
	UpdateTime time.Time              `json:"updateTime"`
}

var (
	projectID = os.Getenv("GCLOUD_PROJECT")
	dataset   = getEnv("BQ_DATASET", "kanso_analytics")
)

// FinalizeHandler is the Cloud Function entry point.
func FinalizeHandler(ctx context.Context, e FirestoreEvent) error {
	meetingID := extractMeetingID(e.Value.Name)
	if meetingID == "" {
		return fmt.Errorf("finalize: could not parse meeting ID from %s", e.Value.Name)
	}
	log.Printf("finalize: streaming meeting %s to BigQuery", meetingID)

	fs, err := firestore.NewClient(ctx, projectID)
	if err != nil {
		return fmt.Errorf("finalize: firestore client: %w", err)
	}
	defer fs.Close()

	bq, err := bigquery.NewClient(ctx, projectID)
	if err != nil {
		return fmt.Errorf("finalize: bigquery client: %w", err)
	}
	defer bq.Close()

	return streamShards(ctx, fs, bq, meetingID)
}

func streamShards(ctx context.Context, fs *firestore.Client, bq *bigquery.Client, meetingID string) error {
	shardsRef := fs.Collection("meetings").Doc(meetingID).Collection("shards")
	docs, err := shardsRef.OrderBy("shardIndex", firestore.Asc).Documents(ctx).GetAll()
	if err != nil {
		return fmt.Errorf("finalize: list shards: %w", err)
	}

	inserter := bq.Dataset(dataset).Table("utterances").Inserter()

	for _, doc := range docs {
		data := doc.Data()
		eventsRaw, ok := data["events"]
		if !ok {
			continue
		}
		events, ok := eventsRaw.([]interface{})
		if !ok {
			continue
		}

		rows := make([]*bigquery.ValuesSaver, 0, len(events))
		for _, ev := range events {
			m, ok := ev.(map[string]interface{})
			if !ok {
				continue
			}
			row, err := shardEventToRow(meetingID, m)
			if err != nil {
				log.Printf("finalize: skipping event: %v", err)
				continue
			}
			rows = append(rows, row)
		}

		if len(rows) == 0 {
			continue
		}

		rowItems := make([]interface{}, len(rows))
		for i, r := range rows {
			rowItems[i] = r
		}
		if err := inserter.Put(ctx, rowItems); err != nil {
			return fmt.Errorf("finalize: bigquery insert: %w", err)
		}
	}
	return nil
}

func shardEventToRow(meetingID string, m map[string]interface{}) (*bigquery.ValuesSaver, error) {
	arrivedAt, _ := m["arrived_at"].(time.Time)
	vclockRaw, _ := json.Marshal(m["vclock_json"])

	return &bigquery.ValuesSaver{
		Schema: bigquery.Schema{
			{Name: "meeting_id"},
			{Name: "utterance_id"},
			{Name: "speaker_id"},
			{Name: "arrived_at"},
			{Name: "redacted_text"},
			{Name: "consensus"},
			{Name: "consensus_delta"},
			{Name: "vclock_json"},
			{Name: "shard_id"},
		},
		InsertID: fmt.Sprintf("%s-%v", meetingID, m["seq"]),
		Row: []bigquery.Value{
			meetingID,
			fmt.Sprintf("%v", m["seq"]),
			fmt.Sprintf("%v", m["speaker_id"]),
			arrivedAt,
			fmt.Sprintf("%v", m["redacted_text"]),
			toFloat(m["consensus"]),
			toFloat(m["consensus_delta"]),
			string(vclockRaw),
			fmt.Sprintf("%v", m["shard_id"]),
		},
	}, nil
}

func toFloat(v interface{}) float64 {
	switch f := v.(type) {
	case float64:
		return f
	case float32:
		return float64(f)
	}
	return 0
}

func extractMeetingID(resourceName string) string {
	// resource name format: projects/{p}/databases/{d}/documents/meetings/{id}/control/finalized
	const prefix = "/documents/meetings/"
	idx := len(resourceName)
	for i := range resourceName {
		if resourceName[i:i+len(prefix)] == prefix {
			rest := resourceName[i+len(prefix):]
			for j, c := range rest {
				if c == '/' {
					return rest[:j]
				}
			}
			return rest
		}
		if i > idx {
			break
		}
	}
	return ""
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
