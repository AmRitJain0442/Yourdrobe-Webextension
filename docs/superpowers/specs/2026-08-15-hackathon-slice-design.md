# Yourdrobe Hackathon Slice Design

**Date:** 2026-08-15

## Goal

Create a locally runnable Chrome extension demo that extracts up to five products from Amazon India, Amazon US, Flipkart, or Nykaa, reuses one locally stored profile photo, simulates asynchronous virtual try-on through a FastAPI backend, displays generated previews, and preserves each original product link.

## Scope

The slice includes:

- A Chrome Manifest V3 extension built with React, TypeScript, and Vite.
- A side panel for onboarding, product discovery, try-on progress, and results.
- Isolated product adapters for Amazon India/US, Flipkart, and Nykaa.
- A minimal FastAPI backend with in-memory sessions, profiles, products, and mock try-on jobs.
- Local development scripts and smoke tests.

The slice excludes live GCP, Vertex AI, YouCam, PostgreSQL, Redis, Docker, category-specific apparel or makeup AI, and all 3D UI, APIs, services, dependencies, and skeletons. Nykaa products still use the same clearly labeled mock preview flow as other products.

## Repository Structure

```text
extension/
  public/manifest.json
  src/background/
  src/content/adapters/
  src/sidepanel/
  src/types.ts
  package.json
backend/
  app/main.py
  tests/test_api.py
  requirements.txt
.gitignore
README.md
```

Website-specific DOM selectors remain inside the Amazon adapter. The backend stays in one application module until real integrations make a split necessary.

## Browser Extension

The content script runs on `https://www.amazon.in/*`, `https://www.amazon.com/*`, `https://www.flipkart.com/*`, and `https://www.nykaa.com/*`. It selects an adapter by hostname and extracts at most five visible product cards into a normalized product shape containing an ID, platform, title, optional brand and price, category, image URL, product URL, and optional shade metadata. Amazon India and Amazon US share one adapter with host-aware currency handling; Flipkart and Nykaa each have their own adapter. The content script responds to extension messages but does not call private services directly.

The service worker opens the Chrome side panel when the extension action is clicked. The side panel requests products from the active tab, guides first-time profile selection, sends the selected image and products to the local backend, polls mock try-on jobs, and renders results with links to the original product listings.

The profile photo is stored only in Chrome local extension storage for this demo. The UI clearly labels this as local demo behavior; production storage and signed uploads are deferred.

## Backend

FastAPI exposes only the endpoints needed by the vertical slice:

- `POST /v1/sessions`
- `POST /v1/profiles`
- `POST /v1/products/normalize`
- `POST /v1/tryons/batch`
- `GET /v1/tryons/{job_id}`
- `GET /health`

State is process-local and resets when the server restarts. Mock try-on jobs use the submitted product image as their completed preview after a short deterministic delay. This preserves the asynchronous API shape without pretending to provide real AI output.

## Data Flow

1. The user opens a search or category page on Amazon India, Amazon US, Flipkart, or Nykaa.
2. The extension side panel asks the content script for up to five products.
3. On first use, the user selects a profile image and explicitly consents to local demo storage.
4. The side panel creates a session and profile, then normalizes the extracted products.
5. The side panel submits a batch try-on request and polls each job.
6. Completed jobs display the product image as a labeled mock preview.
7. The user can open the original Amazon product page.

## Error Handling

The UI provides actionable states for unsupported pages, changed or unreadable site markup, no extractable products, missing profile consent or image, unreachable backend, and failed jobs. A failed product does not hide other completed results. The backend validates request bodies and returns stable HTTP errors without exposing credentials or raw profile data in logs.

## Security

`my-product-sa-key.json`, service-account key patterns, environment files, build output, Python caches, and dependency directories are ignored by Git. No GCP or provider credential is read by this slice, and no secret is bundled into the extension.

## Verification

- One fixture-based adapter test per supported website verifies normalization from representative product-card HTML.
- One FastAPI smoke test covers health, session/profile creation, product normalization, batch job creation, and job completion.
- TypeScript compilation and Vite production build verify the extension.
- The README documents backend startup, extension build, and Chrome unpacked-extension loading.

## Success Criteria

The backend starts locally, its smoke test passes, the extension builds, Chrome loads the unpacked extension, the side panel extracts up to five visible products from Amazon India, Amazon US, Flipkart, and Nykaa listing pages, a user can save one local demo profile image with consent, mock previews complete asynchronously, and every result links to its original product page.
