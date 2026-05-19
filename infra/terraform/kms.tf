# KMS key ring and key for envelope encryption of per-meeting DEKs.
resource "google_kms_key_ring" "kanso" {
  name     = "kanso"
  location = var.region

  depends_on = [google_project_service.apis]
}

# KEK for redaction maps. Sentinel encrypts its per-meeting DEK with this key.
resource "google_kms_crypto_key" "redaction" {
  name            = "redaction"
  key_ring        = google_kms_key_ring.kanso.id
  rotation_period = "7776000s" # 90 days

  lifecycle {
    prevent_destroy = true
  }
}

# Grant Sentinel's service account permission to use the key for encryption + decryption.
resource "google_kms_crypto_key_iam_member" "sentinel_encrypt" {
  crypto_key_id = google_kms_crypto_key.redaction.id
  role          = "roles/cloudkms.cryptoKeyEncrypterDecrypter"
  member        = "serviceAccount:${google_service_account.sentinel.email}"
}

# GCS bucket for encrypted redaction maps (per-meeting map.enc objects).
resource "google_storage_bucket" "redaction_maps" {
  name                        = var.gcs_redaction_bucket
  location                    = var.region
  force_destroy               = false
  uniform_bucket_level_access = true

  encryption {
    default_kms_key_name = google_kms_crypto_key.redaction.id
  }

  versioning {
    enabled = true
  }

  # Retain objects for 7 years (compliance).
  retention_policy {
    retention_period = 220752000 # 7 years in seconds
  }

  depends_on = [google_project_service.apis]
}

# Output the KMS key resource ID so sentinel config can reference it.
output "redaction_kms_key_id" {
  value       = google_kms_crypto_key.redaction.id
  description = "Full resource ID of the redaction KMS key"
}
