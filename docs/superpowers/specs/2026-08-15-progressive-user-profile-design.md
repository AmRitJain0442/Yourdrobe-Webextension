# Progressive User Profile Design

**Status:** Approved on 2026-08-15

## Objective

Replace the single generic profile photo with a browser-local, progressive profile that can supply appropriate user photos and optional measurements for makeup, clothing, jewellery, bags, belts, watches, rings, and footwear. The current mock preview flow remains in place for this phase. Guided camera capture and YouCam integration follow as separate work.

## Product principles

- Ask for a photo only when the current product needs it.
- Keep uploaded photos in the browser and send only required photos to the local backend for the current run.
- Never infer biometric traits, measurements, skin tone, or other sensitive attributes from an image.
- Make every photo and attribute replaceable or deletable by the user.
- Preserve the existing single photo until the user assigns it a profile role.
- Keep the implementation provider-neutral so a later YouCam adapter can map its documented inputs onto the profile.

## Scope

This phase includes:

- file uploads with category-specific guidance;
- a versioned local profile with multiple photo roles;
- progressive missing-photo prompts;
- optional category-specific attributes;
- expanded product typing for makeup, clothes, and accessories;
- local validation, normalization, replacement, and deletion;
- a multi-asset backend profile contract that does not retain image bytes;
- migration of the existing single-photo profile;
- automated frontend and backend tests.

This phase excludes:

- guided camera capture;
- live YouCam or other AI-provider calls;
- generated try-on imagery;
- cloud profile storage, accounts, or cross-device sync;
- automatic pose, body, face, skin-tone, or measurement inference;
- 3D avatars, skeletons, or body tracking.

## Product taxonomy

Products keep their existing broad category and gain an optional fine-grained `product_type`:

- `makeup`
- `eyewear`
- `headwear`
- `earrings`
- `necklace`
- `top`
- `outerwear`
- `dress`
- `bottom`
- `belt`
- `bag`
- `watch`
- `bracelet`
- `ring`
- `footwear`
- `unknown`

Store adapters use small title-based rules for types they can identify reliably. When a product remains `unknown`, the side panel asks the user to choose its type before starting a try-on. The broad category remains available for compatibility and safe fallback behavior.

## Photo roles and requirements

The local profile supports these roles:

- `face_front`
- `face_left`
- `face_right`
- `upper_body_front`
- `upper_body_side`
- `full_body_front`
- `full_body_side`
- `left_hand_wrist`
- `right_hand_wrist`
- `feet_front`
- `feet_side_top`

The first mock run requires only the minimum role below. Optional roles are collected only through profile management or when a future provider requires them.

| Product type | Required role | Optional enhancement |
| --- | --- | --- |
| Makeup, eyewear, headwear | `face_front` | `face_left`, `face_right` |
| Earrings | `face_front` | `face_left`, `face_right` |
| Tops, outerwear, necklaces | `upper_body_front` | `upper_body_side` |
| Dresses, bottoms, belts, bags | `full_body_front` | `full_body_side` |
| Watches, bracelets, rings | Either hand/wrist role | The other hand/wrist role |
| Footwear | `feet_front` | `feet_side_top` |

The requirement resolver computes the union of missing required roles for the products in the current batch. A hand or wrist product is satisfied when either hand/wrist role exists.

## Optional attributes

Attributes never block the mock try-on. The UI shows only fields relevant to the current product types.

- General: height in centimetres.
- Clothing: top size, bottom size, dress size, chest, waist, hips, and inseam in centimetres.
- Makeup: user-selected skin tone and undertone.
- Footwear: shoe-size system and shoe size.
- Jewellery: ring size and left or right wrist circumference in centimetres.

Values are user-entered, locally stored, editable, and removable. The product does not infer them from photos.

## Local data model

`chrome.storage.local` stores lightweight metadata under `yourdrobe_profile_v2`:

```text
ProfileMetadata
  version: 2
  consented_at: ISO timestamp
  assets: map of photo role to asset metadata
  attributes: optional user-entered values
```

Each asset metadata entry contains its role, MIME type, width, height, byte size, and update timestamp. Image blobs live in a native IndexedDB database named `yourdrobe_profile`, keyed by photo role. Replacing a role overwrites only that blob and metadata entry. Deleting the profile removes both IndexedDB blobs and Chrome metadata.

The extension uses native browser APIs and adds no storage dependency.

## File handling

- Accept JPEG, PNG, and WebP.
- Reject unreadable images and source files larger than 10 MB.
- Require at least 720 by 720 pixels for face, hand, and feet roles.
- Require at least 720 by 960 pixels for upper-body roles.
- Require at least 720 by 1280 pixels for full-body roles.
- Normalize oversized images in the browser with Canvas to a maximum 2048-pixel edge and a target size no greater than 2 MB.
- Show role-specific framing guidance before the file chooser.
- Do not upload a file until validation and explicit local-storage consent succeed.

## User experience

### First progressive prompt

1. The user opens supported products and selects **Try these products**.
2. The extension resolves each product type and required profile role.
3. Unknown product types are resolved by a compact user choice.
4. If required roles are missing, the side panel shows file inputs only for those roles.
5. The user reviews the local-storage notice and saves the uploads.
6. The side panel returns to the ready state and starts the mock run when the user confirms.

### Profile management

A **Manage profile** action displays completion by category, existing photo roles, relevant optional attributes, and per-item replace/delete controls. A destructive **Delete complete profile** action requires confirmation and clears both metadata and blobs.

### Legacy migration

If `yourdrobe_profile_image` exists and version 2 metadata does not, the side panel preserves the image as an unclassified legacy asset. The user previews it and assigns a supported role or deletes it. Assignment moves it into IndexedDB and removes the old key only after the new asset is stored successfully.

## Extension data flow

1. Content adapters return products with broad category and fine-grained product type where known.
2. The side panel loads profile metadata and resolves missing photo roles.
3. The profile flow validates and stores only missing or replaced assets.
4. At try-on time, the side panel reads only the required blobs from IndexedDB.
5. Required blobs are converted to data URLs immediately before the local request.
6. The local backend validates consent, roles, and image data, records only role metadata, and discards image bytes after the request.
7. Existing product normalization, mock job creation, bounded polling, and results rendering continue unchanged.

## Backend contract

`POST /v1/profiles` changes from one `image_data_url` to:

```text
session_id
consent
assets[]
  kind
  image_data_url
attributes
```

The request accepts one to eleven uniquely named assets. Every asset must use a supported role and an `image/*` data URL. The backend stores only the profile ID and the set of available roles in bounded memory. It must not store image data URLs or user attributes.

`POST /v1/tryons/batch` validates that the profile has the required role for each product type. A validation failure returns the missing role names in a structured response so the side panel can reopen the progressive upload flow. Mock jobs still return the original product image and remain clearly labelled `Mock AI preview`.

## Privacy and security

- Consent text names browser-local storage and per-run local-backend transmission.
- Photos never leave `127.0.0.1` in this phase.
- Backend logs must not include request bodies, image data, measurements, or attributes.
- Source file names are not persisted.
- A profile can be fully deleted without restarting Chrome or the backend.
- Only the minimum required roles are read and transmitted for a batch.
- No service-account key or external API credential is used.

## Error handling

- Invalid type, size, dimensions, or image decoding produces a role-specific message without discarding other valid uploads.
- IndexedDB quota or write failure leaves the previous asset intact and reports that the profile could not be saved.
- Missing or corrupt blobs remove only the affected metadata entry and return the user to the missing-photo flow.
- Unknown product type requires user classification rather than guessing a sensitive capture requirement.
- Backend validation errors reopen the required profile step; network and timeout errors preserve the saved local profile.
- Cancelling the flow keeps already committed assets and does not save partially validated files.

## Testing

Frontend tests cover:

- product-type to photo-role resolution;
- alternative hand/wrist satisfaction;
- union and deduplication of missing roles;
- progressive prompts for makeup, clothing, accessories, and footwear;
- file type, size, dimension, and decoding validation;
- save, replace, per-role delete, and complete-profile delete behavior;
- legacy single-photo classification without data loss;
- optional attributes remaining non-blocking;
- the existing mock try-on journey with required assets present.

Backend tests cover:

- consent and supported-role validation;
- unique asset roles and the eleven-asset ceiling;
- image bytes and attributes not being retained;
- required-role validation by product type;
- structured missing-role responses;
- existing bounded-memory and mock-job behavior.

The complete extension test suite, backend test suite, TypeScript check, production build, and `git diff --check` must pass before push.

## Acceptance criteria

- A makeup product asks for only a front face photo when none exists.
- A top asks for only an upper-body photo, and a dress asks for only a full-body photo.
- Watches, rings, and bracelets accept either hand/wrist photo.
- Footwear asks for a feet photo.
- Mixed product batches request the deduplicated union of missing roles.
- Existing role photos are reused without prompting.
- Users can replace one asset or delete the complete profile.
- Legacy single-photo data is not silently deleted or misclassified.
- Photos remain browser-local except during an explicit request to the local backend.
- The backend retains no image bytes or optional attributes.
- Mock previews and supported-store extraction continue to work.
- No guided camera, YouCam, cloud, or 3D code is added in this phase.

## Delivery sequence

Implementation is delivered in narrow, reviewable micro commits: taxonomy and requirements, local profile storage, upload and migration UI, backend multi-asset contract, progressive try-on integration, and documentation. Each commit includes its smallest relevant test, and the final branch is verified before push.
