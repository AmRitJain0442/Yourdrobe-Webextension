# YouCam Clothing Integration Design

**Date:** 2026-08-16  
**Status:** Approved for planning

## Goal

Replace mocked previews with live Perfect Corp YouCam results for clothing products while preserving the current Chrome extension, local FastAPI boundary, progressive file-upload profile, and bounded job flow.

This milestone supports tops, outerwear, bottoms, and dresses. Makeup and accessory APIs follow as separate category milestones because they use different provider endpoints, parameters, and image rules.

## Scope

### Included

- AI Clothes V3 virtual try-on for supported clothing products.
- Backend-only YouCam authentication.
- Ordered failover across multiple API keys.
- Separate one-time consent for Perfect Corp cloud processing.
- Session-only generated previews.
- Existing mock mode when no YouCam keys are configured.
- Clear failures without mock substitution when live mode is configured.

### Excluded

- Guided or camera capture.
- Makeup, eyewear, jewellery, watches, bags, hats, and footwear provider calls.
- 3D models, skeletons, or body tracking.
- Persistent generated-result storage.
- Accounts, cross-device profiles, databases, workers, or webhooks.
- A backend product-image proxy unless real provider failures demonstrate that retailer URLs cannot be consumed reliably.

## Provider Facts

The integration follows Perfect Corp's documented asynchronous Clothes V3 workflow:

1. Request a signed upload URL from `POST /s2s/v2.0/file/cloth-v3`.
2. Upload the user image to the returned URL.
3. Create a task with `POST /s2s/v2.0/task/cloth-v3`.
4. Poll `GET /s2s/v2.0/task/cloth-v3/{task_id}` until `success` or `error`.

Requests use Bearer authentication. The API accepts JPEG and PNG images under 10 MB, and generated download URLs are temporary. Perfect Corp documents 30-day removal for uploaded/generated assets and a two-hour lifetime for result download URLs.

References:

- https://docs.perfectcorp.com/reference/ai_clothes/section/overview
- https://docs.perfectcorp.com/develop/file_retention_period
- https://docs.perfectcorp.com/develop/rate_limit

## Architecture

```text
Chrome side panel
  -> local profile blobs in IndexedDB
  -> POST http://127.0.0.1:8001/v1/tryons/batch
       -> YouCam clothes adapter
            -> signed upload
            -> Clothes V3 task
            -> provider task ID
  -> GET http://127.0.0.1:8001/v1/tryons/{job_id}
       -> YouCam task status
       -> temporary result URL or safe failure
```

The extension never calls Perfect Corp directly. The backend is the only credential boundary and continues exposing the existing local session, profile, product, batch, and job endpoints.

The provider code lives in one focused backend module. It uses the already-installed `httpx` dependency and returns small provider-neutral task and result values to the FastAPI routes. No generic plugin framework or speculative provider registry is added.

## Configuration and Key Failover

Keys are supplied only through the backend process environment:

```text
YOUCAM_API_KEYS=key1,key2,key3
```

The backend trims empty values and tries keys in their configured order. It advances to the next key only when upload or task creation fails because of:

- network connection failure;
- request timeout;
- HTTP 401 or 403;
- HTTP 429;
- HTTP 5xx.

It does not rotate keys for malformed requests, invalid user or product images, unsupported parameters, content-safety rejection, or other provider validation errors. These failures would repeat with another key and must be surfaced directly.

After a provider task is created, the local job stores the successful key's index and polls with that same key. It never stores or returns the raw key. Transient polling failures remain processing until the bounded client polling budget expires; terminal provider errors produce a failed job.

When `YOUCAM_API_KEYS` is absent or empty, the backend retains the current explicitly labelled mock behavior for local development and automated tests. When at least one key is configured, any provider failure is shown as a failure and never replaced by a mock preview.

## Product and Profile Mapping

The live milestone maps products as follows:

| Product type | Profile role | YouCam garment category |
| --- | --- | --- |
| `top` | `upper_body_front` | `upper_body` |
| `outerwear` | `upper_body_front` | `upper_body` |
| `bottom` | `full_body_front` | `lower_body` |
| `dress` | `full_body_front` | `full_body` |

Other product types create an immediately failed local job with a stable `unsupported_live_category` code and a clear message that live preview is not yet supported for that category.

The retailer product `image_url` is sent to YouCam as `ref_file_url`. The backend does not fetch arbitrary retailer image URLs. If YouCam cannot download or decode a product reference, the job fails with a product-image message. A restricted fetch-and-convert proxy is considered only after observed failures justify the security and maintenance cost.

Stored profile JPEG and PNG assets are passed through unchanged. Stored WebP assets are converted to JPEG during the explicit per-run load using browser-native image and canvas APIs. The original IndexedDB blob is not replaced.

## Consent and Privacy

Existing profile consent covers browser-local storage and per-run transmission to the local backend. It does not authorize cloud processing.

Before the first live YouCam run, the side panel requires a separate acknowledgement that:

- the required user photo and retailer product image will be sent to Perfect Corp;
- Perfect Corp may retain uploaded and generated assets for up to 30 days;
- generated download URLs are temporary;
- previews are not saved by Yourdrobe after the side-panel session.

The acknowledgement timestamp is stored in Chrome local profile metadata as `youcam_consented_at`. Existing profiles without it are prompted once. Deleting the complete profile removes it with the rest of the metadata.

The batch request also includes `cloud_consent: true`. The backend rejects live provider creation when this value is absent or false. This is a trust-boundary check, not a replacement for the UI acknowledgement.

The backend holds image bytes only during signed upload and task creation. Local jobs retain provider task identifiers, product identifiers, status, safe errors, result URLs, and key indexes, but never input image bytes, data URLs, or credentials.

## API and Job Flow

The extension continues creating a session, sending profile roles, normalizing products, and starting a batch. The batch payload gains the required per-run assets and `cloud_consent` so the backend has the image needed for live task creation without retaining it in the profile collection.

For each product in a batch of at most five:

1. Validate session, product, profile role, live consent, and product category.
2. Decode and validate the required image data URL.
3. Try signed upload and task creation with keys in order.
4. Store a bounded local job containing the provider task ID and successful key index.
5. Discard request image bytes after task creation returns.
6. Return queued jobs immediately.

The extension polls local jobs every two seconds for at most 80 seconds. The local job route polls Perfect Corp and maps provider status into the existing `queued`, `processing`, `completed`, and `failed` states. Cancellation aborts local fetches and stops client polling; it does not claim to cancel an already-created provider task.

Completed live jobs return `mock: false` and the temporary YouCam `result_url`. The UI labels them `YouCam AI preview`. Mock-development jobs remain labelled `Mock AI preview`.

## Error Handling

The backend maps provider responses into stable local codes without returning provider payloads or credentials:

- `youcam_keys_exhausted`
- `youcam_rate_limited`
- `invalid_user_image`
- `invalid_product_image`
- `provider_safety_rejection`
- `provider_processing_failed`
- `unsupported_live_category`
- `live_consent_required`

The extension renders the corresponding safe message for each failed product and preserves its original listing link. A mixed batch may therefore contain completed clothing previews and failed unsupported products.

No automatic mock fallback occurs after a live task failure.

## Testing

Backend tests use `httpx.MockTransport` and consume no provider units. They cover:

- configuration parsing without leaking keys;
- upload metadata, signed PUT, task creation, and polling;
- clothing category and profile-role mapping;
- eligible ordered key rotation;
- no rotation for validation and safety failures;
- all-keys-exhausted behavior;
- live-consent enforcement;
- bounded job storage without input images or raw keys;
- mock mode when no keys are configured;
- live failures never becoming mock results.

Extension tests cover:

- the one-time cloud acknowledgement;
- existing consent avoiding repeat prompts;
- WebP-to-JPEG per-run conversion;
- batch assets and cloud consent;
- two-second bounded polling and cancellation;
- live, mock, failure, and unsupported-category labels;
- session-only results.

A manual smoke test may be run with a real key and sample clothing images after automated tests pass. It is never part of CI and must not print the key.

## Delivery

Implementation is split into narrow micro-commits:

1. backend YouCam client and deterministic key failover;
2. live job orchestration and API contracts;
3. extension cloud consent and provider-ready asset loading;
4. live result, polling, and failure UI;
5. documentation and real-key smoke instructions.

Each implementation commit includes its smallest relevant regression test. The final branch receives a scoped review, complete automated verification, and a push only after all blocking findings are resolved.

## Acceptance Criteria

- With valid `YOUCAM_API_KEYS`, a supported clothing listing produces a live YouCam preview.
- The extension never receives or stores an API key.
- A failed eligible key advances to the next configured key.
- Invalid inputs and safety rejection do not consume every key.
- Live provider failure is visible and never substituted with a mock.
- Without configured keys, the current labelled mock journey remains usable.
- Cloud processing never begins without the separate acknowledgement and backend flag.
- Generated previews remain session-only.
- Guided capture and non-clothing provider APIs are absent from this milestone.
