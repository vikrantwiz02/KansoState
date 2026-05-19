variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "region" {
  description = "GCP region for Cloud Run and other regional resources"
  type        = string
  default     = "us-central1"
}

variable "environment" {
  description = "Deployment environment (production | staging)"
  type        = string
  default     = "production"
  validation {
    condition     = contains(["production", "staging"], var.environment)
    error_message = "environment must be 'production' or 'staging'."
  }
}

variable "sentinel_image" {
  description = "Fully-qualified Docker image for the sentinel service"
  type        = string
}

variable "semantic_image" {
  description = "Fully-qualified Docker image for the semantic sidecar"
  type        = string
}

variable "semantic_replica_count" {
  description = "Number of semantic sidecar replicas"
  type        = number
  default     = 2
}

variable "gcs_redaction_bucket" {
  description = "GCS bucket name for encrypted redaction maps"
  type        = string
}

variable "bigquery_dataset" {
  description = "BigQuery dataset ID"
  type        = string
  default     = "kanso_analytics"
}

variable "alert_notification_channel" {
  description = "Monitoring notification channel for SLO alerts (optional)"
  type        = string
  default     = ""
}
