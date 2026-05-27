locals {
  sentinel_env = {
    KANSO_ENV            = var.environment
    FIRESTORE_PROJECT_ID = var.project_id
    LOG_LEVEL            = "info"
    EMBEDDER_URLS = join(",", [
      for i in range(var.semantic_replica_count) :
      google_cloud_run_v2_service.semantic[i].uri
    ])
  }
}

# Sentinel — single Cloud Run service (sticky-session routing by meetingId hash
# is handled at the load-balancer level via a session affinity header).
resource "google_cloud_run_v2_service" "sentinel" {
  name     = "kanso-sentinel-${var.environment}"
  location = var.region

  template {
    service_account = google_service_account.sentinel.email

    scaling {
      min_instance_count = 1
      max_instance_count = 10
    }

    containers {
      image = var.sentinel_image

      resources {
        limits = {
          cpu    = "2"
          memory = "1Gi"
        }
        startup_cpu_boost = true
      }

      dynamic "env" {
        for_each = local.sentinel_env
        content {
          name  = env.key
          value = env.value
        }
      }

      env {
        name  = "REDACTION_KMS_KEY_ID"
        value = google_kms_crypto_key.redaction.id
      }

      liveness_probe {
        http_get { path = "/healthz" }
        initial_delay_seconds = 10
        period_seconds        = 15
      }

      startup_probe {
        http_get { path = "/healthz" }
        failure_threshold = 6
        period_seconds    = 5
      }
    }
  }

  depends_on = [
    google_project_iam_member.sentinel_firestore,
    google_project_iam_member.sentinel_kms_decrypt,
  ]
}

# Semantic sidecar — N replicas, each its own Cloud Run service.
resource "google_cloud_run_v2_service" "semantic" {
  count    = var.semantic_replica_count
  name     = "kanso-semantic-${var.environment}-${count.index}"
  location = var.region

  template {
    service_account = google_service_account.semantic.email

    scaling {
      min_instance_count = 1
      max_instance_count = 5
    }

    containers {
      image = var.semantic_image

      resources {
        limits = {
          cpu    = "4"
          memory = "4Gi" # sentence-transformers model needs headroom
        }
        startup_cpu_boost = true
      }

      env {
        name  = "EMBEDDING_PROVIDER"
        value = "sentence_transformers"
      }
      env {
        name  = "MODEL_NAME"
        value = "all-MiniLM-L6-v2"
      }
      env {
        name  = "PORT"
        value = "8090"
      }

      liveness_probe {
        http_get { path = "/healthz" }
        initial_delay_seconds = 30 # model load takes ~20s cold
        period_seconds        = 20
      }

      startup_probe {
        http_get { path = "/healthz" }
        failure_threshold = 12
        period_seconds    = 5
      }
    }
  }
}

# Allow unauthenticated access to the dashboard-facing sentinel endpoints.
# In production, front with Cloud Armor + IAP for authenticated routes.
resource "google_cloud_run_v2_service_iam_member" "sentinel_public" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.sentinel.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# Semantic sidecar is only callable by sentinel's service account.
resource "google_cloud_run_v2_service_iam_member" "semantic_sentinel" {
  count    = var.semantic_replica_count
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.semantic[count.index].name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.sentinel.email}"
}

output "sentinel_url" {
  value       = google_cloud_run_v2_service.sentinel.uri
  description = "Public URL of the Sentinel service"
}
