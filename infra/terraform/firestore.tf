# Firestore in Native mode — required for real-time listeners and subcollections.
resource "google_firestore_database" "kanso" {
  project                     = var.project_id
  name                        = "(default)"
  location_id                 = var.region
  type                        = "FIRESTORE_NATIVE"
  concurrency_mode            = "OPTIMISTIC"
  app_engine_integration_mode = "DISABLED"

  depends_on = [google_project_service.apis]
}

# Composite index: meetingId + shardIndex ASC (required for ordered shard reads).
resource "google_firestore_index" "shards_by_index" {
  project    = var.project_id
  database   = google_firestore_database.kanso.name
  collection = "shards"

  fields {
    field_path = "meetingId"
    order      = "ASCENDING"
  }
  fields {
    field_path = "shardIndex"
    order      = "ASCENDING"
  }
}

# Backup schedule — daily, retained for 7 days.
resource "google_firestore_backup_schedule" "daily" {
  project  = var.project_id
  database = google_firestore_database.kanso.name

  daily_recurrence {}

  retention = "604800s" # 7 days
}
