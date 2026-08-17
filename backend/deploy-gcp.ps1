[CmdletBinding()]
param(
    [string]$ProjectId = "tribe-v2-host",
    [string]$VertexProjectId = "project-a2dcdad0-5d65-4d61-846",
    [string]$Region = "asia-south1",
    [string]$ServiceName = "yourdrobe-api",
    [string]$SecretName = "yourdrobe-youcam-api-keys",
    [string]$Model = "gemini-3.1-flash-image"
)

$ErrorActionPreference = "Stop"
$serviceAccountName = "yourdrobe-api"
$serviceAccount = "$serviceAccountName@$ProjectId.iam.gserviceaccount.com"

function Invoke-Gcloud {
    & gcloud @args
    if ($LASTEXITCODE -ne 0) {
        throw "gcloud failed: gcloud $($args -join ' ')"
    }
}

Invoke-Gcloud services enable `
    run.googleapis.com `
    cloudbuild.googleapis.com `
    artifactregistry.googleapis.com `
    secretmanager.googleapis.com `
    --project $ProjectId

$existingServiceAccount = & gcloud iam service-accounts list `
    --project $ProjectId `
    --filter "email=$serviceAccount" `
    --format "value(email)"
if ($LASTEXITCODE -ne 0) {
    throw "Could not inspect service accounts in $ProjectId."
}
if (-not $existingServiceAccount) {
    Invoke-Gcloud iam service-accounts create $serviceAccountName `
        --project $ProjectId `
        --display-name "Yourdrobe API runtime"
}

Invoke-Gcloud projects add-iam-policy-binding $VertexProjectId `
    --member "serviceAccount:$serviceAccount" `
    --role roles/aiplatform.user `
    --condition None

Invoke-Gcloud secrets add-iam-policy-binding $SecretName `
    --project $ProjectId `
    --member "serviceAccount:$serviceAccount" `
    --role roles/secretmanager.secretAccessor `
    --condition None

Invoke-Gcloud run deploy $ServiceName `
    --project $ProjectId `
    --region $Region `
    --source $PSScriptRoot `
    --service-account $serviceAccount `
    --set-secrets "YOUCAM_API_KEYS=${SecretName}:latest" `
    --set-env-vars "GOOGLE_GENAI_ENABLED=true,GOOGLE_CLOUD_PROJECT=$VertexProjectId,GOOGLE_CLOUD_LOCATION=global,NANO_BANANA_MODEL=$Model" `
    --memory 1Gi `
    --cpu 1 `
    --concurrency 8 `
    --timeout 300 `
    --min 0 `
    --max 1 `
    --no-allow-unauthenticated `
    --quiet

Invoke-Gcloud run services describe $ServiceName `
    --project $ProjectId `
    --region $Region `
    --format "value(status.url)"
