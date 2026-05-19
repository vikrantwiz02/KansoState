resource "google_bigquery_dataset" "kanso" {
  dataset_id                  = var.bigquery_dataset
  location                    = "US"
  default_table_expiration_ms = null # no expiration — managed via partition expiry per table

  access {
    role          = "OWNER"
    special_group = "projectOwners"
  }
  access {
    role          = "READER"
    special_group = "projectReaders"
  }
  access {
    role          = "WRITER"
    user_by_email = google_service_account.finalize_fn.email
  }

  depends_on = [google_project_service.apis]
}

resource "google_bigquery_table" "meetings" {
  dataset_id          = google_bigquery_dataset.kanso.dataset_id
  table_id            = "meetings"
  deletion_protection = true
  schema              = file("${path.module}/../bigquery/schemas/meetings.json")
}

resource "google_bigquery_table" "utterances" {
  dataset_id          = google_bigquery_dataset.kanso.dataset_id
  table_id            = "utterances"
  deletion_protection = true
  schema              = file("${path.module}/../bigquery/schemas/utterances.json")

  time_partitioning {
    type  = "DAY"
    field = "arrived_at"
  }

  clustering = ["meeting_id", "speaker_id"]
}

resource "google_bigquery_table" "consensus_timeseries" {
  dataset_id          = google_bigquery_dataset.kanso.dataset_id
  table_id            = "consensus_timeseries"
  deletion_protection = true
  schema              = file("${path.module}/../bigquery/schemas/consensus_timeseries.json")

  time_partitioning {
    type  = "DAY"
    field = "ts"
  }
}
