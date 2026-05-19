terraform {
  required_version = ">= 1.8"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.39"
    }
  }
  # Remote state — update bucket/prefix for your project before applying.
  backend "gcs" {
    bucket = "kanso-terraform-state"
    prefix = "kanso/state"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# Enable required APIs.
resource "google_project_service" "apis" {
  for_each = toset([
    "firestore.googleapis.com",
    "bigquery.googleapis.com",
    "cloudkms.googleapis.com",
    "storage.googleapis.com",
    "run.googleapis.com",
    "cloudfunctions.googleapis.com",
    "cloudbuild.googleapis.com",
    "iam.googleapis.com",
    "cloudresourcemanager.googleapis.com",
  ])
  service            = each.key
  disable_on_destroy = false
}

# Service account for the Sentinel Cloud Run service.
resource "google_service_account" "sentinel" {
  account_id   = "kanso-sentinel"
  display_name = "KansoState Sentinel"
}

# Service account for the Semantic sidecar.
resource "google_service_account" "semantic" {
  account_id   = "kanso-semantic"
  display_name = "KansoState Semantic Sidecar"
}

# Sentinel needs Firestore read/write and KMS decrypt.
resource "google_project_iam_member" "sentinel_firestore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.sentinel.email}"
}

resource "google_project_iam_member" "sentinel_kms_decrypt" {
  project = var.project_id
  role    = "roles/cloudkms.cryptoKeyDecrypter"
  member  = "serviceAccount:${google_service_account.sentinel.email}"
}

resource "google_project_iam_member" "sentinel_gcs_write" {
  project = var.project_id
  role    = "roles/storage.objectCreator"
  member  = "serviceAccount:${google_service_account.sentinel.email}"
}

# Cloud Function service account needs BigQuery insert.
resource "google_service_account" "finalize_fn" {
  account_id   = "kanso-finalize-fn"
  display_name = "KansoState Finalize Function"
}

resource "google_project_iam_member" "finalize_bq" {
  project = var.project_id
  role    = "roles/bigquery.dataEditor"
  member  = "serviceAccount:${google_service_account.finalize_fn.email}"
}

resource "google_project_iam_member" "finalize_firestore" {
  project = var.project_id
  role    = "roles/datastore.viewer"
  member  = "serviceAccount:${google_service_account.finalize_fn.email}"
}
