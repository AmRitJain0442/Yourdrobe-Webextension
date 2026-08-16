# Active Outfit Composition Design

**Date:** 2026-08-16

## Goal

Use a front full-body profile image for every live clothing try-on and let the user preserve one successful rendered outfit as the source image for subsequent try-ons. A user can save a top result, browse for bottoms, and render each bottom against the saved top outfit.

## Scope

This slice implements active-outfit composition for the currently integrated YouCam Clothes V3 categories:

- `top`
- `outerwear`
- `bottom`
- `dress`

Shoes, jewellery, eyewear, bags, and other accessories use separate Perfect Corp APIs that are not integrated yet. The active-outfit storage and request contract will be provider-neutral so those later integrations can reuse it without changing the saved-outfit model.

Guided capture, multiple named outfits, editable garment layers, background jobs, databases, and non-clothing provider integrations are outside this slice.

## Full-Body Source Selection

Every supported live clothing type requires `full_body_front`:

| Product type | Source role | YouCam garment category |
|---|---|---|
| `top` | `full_body_front` | `upper_body` |
| `outerwear` | `full_body_front` | `upper_body` |
| `bottom` | `full_body_front` | `lower_body` |
| `dress` | `full_body_front` | `full_body` |

There is no `upper_body_front` fallback for live clothes. If the full-body image is absent, the extension opens file-upload profile setup and blocks the try-on until the image is saved.

The change applies consistently in both the extension requirement mapping and backend live mapping. Non-clothing requirement mappings remain unchanged.

## Active Outfit Model

The extension stores at most one active outfit in the existing browser-local profile database:

- A rendered JPEG or PNG blob under a dedicated `active_outfit` key.
- Metadata in `chrome.storage.local` under a versioned key.
- Metadata includes the source job ID, product ID, product title, product type, product URL, and save timestamp.

The active outfit contains a flattened rendered image, not independent garment layers. Saving another result atomically replaces the image and metadata. Resetting deletes both and returns source selection to `full_body_front`.

The active outfit persists across browser and side-panel restarts until it is replaced, reset, or the complete local profile is deleted. Complete-profile deletion also removes the active outfit.

## Result Preservation

YouCam result URLs are temporary, so the extension must not persist the URL as the outfit source.

For a successfully completed live YouCam job, the result UI shows **Use as active outfit**. The action calls a local-backend endpoint for that job. The backend:

1. Confirms the job exists, is completed, is live rather than mock, and has a validated HTTPS result URL.
2. Downloads only an allowlisted Perfect Corp result host without following redirects.
3. Enforces an image content type and a 10 MB response limit.
4. Returns the image bytes without retaining them.

The extension validates that the response decodes as an image, then stores the blob and metadata browser-locally. Invalid, oversized, missing, mock, or expired results fail with a user-visible message and leave the current active outfit unchanged.

No API key, profile image, saved outfit, or rendered image is written to backend storage or logs.

## Sequential Try-On Flow

At side-panel startup, the extension loads active-outfit metadata and checks that its local blob exists and decodes. Corrupt metadata or a missing/invalid blob is cleared safely.

When a supported live clothing batch starts:

1. The original profile must contain `full_body_front` unless a valid active outfit already exists.
2. If an active outfit exists, the extension sends it in a dedicated optional `outfit_base_image_data_url` batch field.
3. Otherwise, the extension sends the original `full_body_front` profile asset.
4. The backend uses the active outfit as the source image for every supported product in that batch; otherwise it uses `full_body_front`.
5. Products in the same batch are alternatives. They all start from the same active outfit and do not automatically chain into one another.
6. Only the result explicitly selected with **Use as active outfit** becomes the source for the next shopping step.

A failed or cancelled batch does not mutate the active outfit.

## User Interface

The ready and results screens show a compact **Active outfit** section when one exists:

- A local preview image.
- The saved product title and type.
- A source-listing link.
- **Reset to original profile photo**.

Each successful live result shows **Use as active outfit**. Mock results, failed jobs, and results without a valid live image cannot be saved as an outfit base.

While preservation or reset is running, related controls are disabled to prevent overlapping writes. Errors use the existing alert styling and do not close the results screen.

## Consent and Privacy

The existing local-profile and Perfect Corp cloud-processing consents cover the same data path: the saved active outfit remains browser-local and is transmitted to the local backend only for a user-initiated live try-on. It is then uploaded to Perfect Corp as the next source image under the documented provider retention terms.

The active-outfit UI states that the saved rendered image is browser-local and will be sent to Perfect Corp when used for another live preview.

## Provider Limitation

Sequential composition is raster editing. The next provider task receives the previous rendered image as a new source, so it may subtly alter previously rendered garments, the person, or the background. The application must not claim pixel-perfect layer preservation.

Perfect Corp Clothes V3 accepts an uploaded source image and returns a rendered image URL, which makes sequential sourcing technically possible. Exact preservation of earlier garments is not documented or guaranteed.

## Testing

Automated tests use no provider units and cover:

- Tops and outerwear require `full_body_front` with no upper-body fallback.
- All four live clothing mappings use `full_body_front` while retaining their garment categories.
- Active-outfit blob and metadata save, load, atomic replacement, reset, corruption cleanup, and complete-profile deletion.
- Result preservation rejects mock, incomplete, expired, redirected, disallowed-host, non-image, and oversized responses.
- A saved top result becomes the source for a later bottom request.
- Multiple products in one batch share one base rather than chaining automatically.
- Save/reset single-flight behavior, visible errors, and accessible controls.
- Existing mock mode, key failover, consent, profile upload, extension tests, backend tests, and production build remain green.

A manual real-key smoke test may verify top-to-bottom composition after automated verification. It is never run automatically because it consumes provider units.

## Future Provider Slices

Shoes and accessories will each add their own Perfect Corp client, validation rules, product mapping, and tests. Their completed live results will use the same **Use as active outfit** action, and their requests will consume the same active-outfit base. This avoids duplicating storage or composition behavior while keeping provider-specific contracts isolated.

## Reference

- [Perfect Corp AI Clothes V3 integration guide](https://docs.perfectcorp.com/reference/ai_clothes/section/overview)
