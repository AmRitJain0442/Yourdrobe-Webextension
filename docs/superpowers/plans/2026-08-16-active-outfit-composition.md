# Active Outfit Composition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require a full-body source for every live clothing try-on and let one successful YouCam result become the browser-local source for later clothing try-ons.

**Architecture:** The extension persists one flattened active-outfit blob and versioned metadata in the existing local profile stores. The backend securely materializes an explicitly selected completed YouCam result and accepts an optional active-outfit source on later batches; all products in one batch use the same base. Category-specific shoe and accessory providers remain separate future slices.

**Tech Stack:** React 19, TypeScript, Chrome Extension Manifest V3, IndexedDB, `chrome.storage.local`, Vitest, FastAPI, Pydantic, HTTPX, Python `unittest`

## Global Constraints

- Live `top`, `outerwear`, `bottom`, and `dress` require `full_body_front`; there is no `upper_body_front` fallback.
- Preserve the YouCam garment categories: `upper_body`, `upper_body`, `lower_body`, and `full_body` respectively.
- Persist exactly one flattened active outfit browser-locally until replace, reset, or complete-profile deletion.
- Never persist a temporary YouCam result URL as the active outfit.
- Only completed, non-mock live results can become the active outfit.
- The backend downloads only allowlisted Perfect Corp result hosts, follows no redirects, accepts only JPEG/PNG, and rejects payloads at or above 10 MB.
- Failed save, reset, try-on, or provider operations leave the previous active outfit unchanged.
- Every product in a batch starts from the same active outfit; products do not chain automatically.
- No guided capture, multiple named outfits, editable layers, database, worker, webhook, shoe API, or accessory API is added.
- No real API key or provider-unit test enters source control or automated verification.
- Use one logical micro-commit per task and do not amend reviewed task commits.

---

### Task 1: Require a full-body source for all live clothes

**Files:**
- Modify: `extension/src/profile/requirements.ts`
- Modify: `extension/src/profile/requirements.test.ts`
- Modify: `backend/app/main.py`
- Modify: `backend/tests/test_api.py`

**Interfaces:**
- Produces: `requirementsForProducts([top|outerwear|bottom|dress]) -> ["full_body_front"]` after stable deduplication.
- Produces: `LIVE_MAPPING[type] -> ("full_body_front", garment_category)` for all four live types.

- [ ] **Step 1: Write failing extension mapping tests**

Add literal expectations:

```ts
it("requires one full-body image for every live clothing type", () => {
  expect(requirementsForProducts([
    product("top"), product("outerwear"), product("bottom"), product("dress"),
  ])).toEqual(["full_body_front"]);
  expect(missingRequirements([product("top")], ["upper_body_front"]))
    .toEqual(["full_body_front"]);
});
```

- [ ] **Step 2: Write failing backend source tests**

Update the live-category table test so every case supplies distinguishable upper/full-body data URLs and expects the full-body value:

```python
cases = {
    "top": ("upper_body", "data:image/jpeg;base64,ZnVsbA=="),
    "outerwear": ("upper_body", "data:image/jpeg;base64,ZnVsbA=="),
    "bottom": ("lower_body", "data:image/jpeg;base64,ZnVsbA=="),
    "dress": ("full_body", "data:image/jpeg;base64,ZnVsbA=="),
}
```

- [ ] **Step 3: Run RED**

```powershell
npm.cmd --prefix extension test -- requirements.test.ts
$env:PYTHONPATH='backend'
backend\.venv\Scripts\python.exe -m unittest backend.tests.test_api.ApiJourneyTest.test_live_categories_map_to_provider_garments -v
```

Expected: tops and outerwear still select `upper_body_front`.

- [ ] **Step 4: Implement the minimal mapping change**

Use these exact mappings:

```ts
necklace: "upper_body_front",
top: "full_body_front",
outerwear: "full_body_front",
dress: "full_body_front",
bottom: "full_body_front",
```

```python
"top": (("full_body_front",),),
"outerwear": (("full_body_front",),),

LIVE_MAPPING = {
    "top": ("full_body_front", "upper_body"),
    "outerwear": ("full_body_front", "upper_body"),
    "bottom": ("full_body_front", "lower_body"),
    "dress": ("full_body_front", "full_body"),
}
```

- [ ] **Step 5: Run GREEN and commit**

```powershell
npm.cmd --prefix extension test -- requirements.test.ts
$env:PYTHONPATH='backend'
backend\.venv\Scripts\python.exe -m unittest backend.tests.test_api -v
git diff --check
git add extension/src/profile/requirements.ts extension/src/profile/requirements.test.ts backend/app/main.py backend/tests/test_api.py
git commit -m "fix: require full-body clothing sources"
```

---

### Task 2: Persist one browser-local active outfit

**Files:**
- Modify: `extension/src/profile/types.ts`
- Modify: `extension/src/profile/store.ts`
- Modify: `extension/src/profile/store.test.ts`

**Interfaces:**
- Produces: `ActiveOutfitMetadata` and `ActiveOutfit` types.
- Produces: `ActiveOutfitInput = Pick<ActiveOutfitMetadata, "job_id" | "product_id" | "product_title" | "product_type" | "product_url">`.
- Produces: `saveActiveOutfit(blob: Blob, input: ActiveOutfitInput) -> Promise<ActiveOutfit>`.
- Produces: `loadActiveOutfit() -> Promise<ActiveOutfit | null>`.
- Produces: `deleteActiveOutfit() -> Promise<void>`.
- `ActiveOutfit.image_data_url` is the provider-ready source and local preview.

- [ ] **Step 1: Write failing storage tests**

Cover real IndexedDB and Chrome storage behavior:

```ts
const outfitInput = {
  job_id: "job-top", product_id: "product-top", product_title: "Blue top",
  product_type: "top" as const, product_url: "https://amazon.in/dp/TOP",
};

it("saves and loads one active outfit without persisting a provider URL", async () => {
  const saved = await saveActiveOutfit(new Blob(["render"], { type: "image/jpeg" }), outfitInput);
  expect(saved.metadata).toMatchObject({ version: 1, job_id: "job-top", product_type: "top" });
  expect(saved.image_data_url).toBe("data:image/jpeg;base64,cmVuZGVy");
  expect(values.yourdrobe_active_outfit_v1).not.toHaveProperty("result_url");
});

it("atomically replaces and resets the active outfit", async () => {
  await saveActiveOutfit(new Blob(["old"], { type: "image/jpeg" }), outfitInput);
  await saveActiveOutfit(new Blob(["new"], { type: "image/png" }), { ...outfitInput, job_id: "job-new" });
  expect((await loadActiveOutfit())?.image_data_url).toBe("data:image/png;base64,bmV3");
  await deleteActiveOutfit();
  expect(await loadActiveOutfit()).toBeNull();
});
```

Also test rollback after metadata-write failure, cleanup of missing/zero-byte/non-image/undecodable blobs, serialization with profile mutations, and `deleteProfile()` removing the outfit blob and metadata.

- [ ] **Step 2: Run RED**

```powershell
npm.cmd --prefix extension test -- store.test.ts
```

Expected: active-outfit types and functions are absent.

- [ ] **Step 3: Add the exact types**

```ts
export type ActiveOutfitMetadata = {
  version: 1;
  job_id: string;
  product_id: string;
  product_title: string;
  product_type: ProductType;
  product_url: string;
  mime_type: "image/jpeg" | "image/png";
  byte_size: number;
  saved_at: string;
};

export type ActiveOutfit = {
  metadata: ActiveOutfitMetadata;
  image_data_url: string;
};

export type ActiveOutfitInput = Pick<ActiveOutfitMetadata,
  "job_id" | "product_id" | "product_title" | "product_type" | "product_url"
>;
```

Import `ProductType` from `../types` with `import type`.

- [ ] **Step 4: Implement storage using the existing lock and object store**

Use exact private keys:

```ts
const activeOutfitBlobKey = "active_outfit";
const activeOutfitMetadataKey = "yourdrobe_active_outfit_v1";
```

Validate non-empty JPEG/PNG below 10 MB and decode with `createImageBitmap`; always close the bitmap. Save the blob first, then metadata, restoring the previous blob if metadata fails. On load corruption, remove both parts and return `null`. Add both metadata keys to `deleteProfile()` and rely on the existing object-store clear for the blob.

- [ ] **Step 5: Run GREEN and commit**

```powershell
npm.cmd --prefix extension test -- store.test.ts
git diff --check
git add extension/src/profile/types.ts extension/src/profile/store.ts extension/src/profile/store.test.ts
git commit -m "feat: store one active outfit locally"
```

---

### Task 3: Securely materialize completed YouCam results

**Files:**
- Modify: `backend/app/youcam.py`
- Modify: `backend/tests/test_youcam.py`
- Modify: `backend/app/main.py`
- Modify: `backend/tests/test_api.py`

**Interfaces:**
- Produces: `YouCamClient.download_result(url: str) -> tuple[bytes, str]` where the second value is `image/jpeg | image/png`.
- Produces: `GET /v1/tryons/{job_id}/result-image` returning raw image bytes.
- A completed live job stores its result URL only in the existing bounded in-memory job entry until explicitly materialized.

- [ ] **Step 1: Write failing provider-download tests**

Use `httpx.MockTransport` to prove:

```python
content, content_type = client.download_result(
    "https://yce-us.s3-accelerate.amazonaws.com/demo/ttl30/result.jpg"
)
self.assertEqual((content, content_type), (b"image", "image/jpeg"))
```

Add separate rejection cases for HTTP, non-`yce-*.s3-accelerate.amazonaws.com`, redirects, non-200 responses, non-JPEG/PNG content types, and responses whose accumulated bytes reach 10 MB.

- [ ] **Step 2: Write failing endpoint tests**

Add a fake-client `download_result` implementation and test:

```python
completed = self.client.get(f"/v1/tryons/{job_id}").json()
response = self.client.get(f"/v1/tryons/{job_id}/result-image")
self.assertEqual(response.status_code, 200)
self.assertEqual(response.content, b"rendered")
self.assertEqual(response.headers["content-type"], "image/jpeg")
```

Add 404 for unknown job; 409 for queued, failed, and mock jobs; and safe 502 for provider download failure.

- [ ] **Step 3: Run RED**

```powershell
$env:PYTHONPATH='backend'
backend\.venv\Scripts\python.exe -m unittest backend.tests.test_youcam backend.tests.test_api -v
```

Expected: `download_result` and the result-image endpoint are absent.

- [ ] **Step 4: Implement the constrained downloader**

Use the existing HTTPX client with redirects disabled. Validate the parsed HTTPS hostname starts with `yce-` and ends with `.s3-accelerate.amazonaws.com`. Stream chunks, reject when accumulated bytes are `>= MAX_IMAGE_BYTES`, and map every failure to:

```python
YouCamFailure("provider_result_unavailable", "This YouCam result is no longer available.")
```

- [ ] **Step 5: Implement the endpoint and job completion state**

When polling completes, store `job["result_url"]` and `job["completed"] = True`. The endpoint accepts only `mock is False`, `completed is True`, and a string result URL, then returns:

```python
content, media_type = youcam.download_result(job["result_url"])
return Response(content=content, media_type=media_type)
```

Never log the URL, bytes, or credentials.

- [ ] **Step 6: Run GREEN and commit**

```powershell
$env:PYTHONPATH='backend'
backend\.venv\Scripts\python.exe -m unittest backend.tests.test_youcam backend.tests.test_api -v
git diff --check
git add backend/app/youcam.py backend/tests/test_youcam.py backend/app/main.py backend/tests/test_api.py
git commit -m "feat: preserve completed YouCam results"
```

---

### Task 4: Use an active outfit as the live batch source

**Files:**
- Modify: `backend/app/main.py`
- Modify: `backend/tests/test_api.py`
- Modify: `extension/src/sidepanel/api.ts`
- Create: `extension/src/sidepanel/api.test.ts`

**Interfaces:**
- Extends `startDemo(..., outfitBaseImageDataUrl?: string, signal?: AbortSignal)`.
- Extends `BatchInput` with `outfit_base_image_data_url: str | None` bounded to 14,000,000 characters.
- Active outfit overrides `full_body_front` only for supported live products.

- [ ] **Step 1: Write failing backend batch tests**

Create a mixed top/bottom batch with distinct profile and outfit data URLs:

```python
body["outfit_base_image_data_url"] = "data:image/jpeg;base64,b3V0Zml0"
response = self.client.post("/v1/tryons/batch", json=body)
self.assertEqual([call[0] for call in fake.created], [
    "data:image/jpeg;base64,b3V0Zml0",
    "data:image/jpeg;base64,b3V0Zml0",
])
self.assertEqual([call[2] for call in fake.created], ["upper_body", "lower_body"])
```

Add rejection tests for non-image and oversized bases. Prove a valid base satisfies the live clothing source even when profile assets are empty; non-clothing requirements remain enforced.

- [ ] **Step 2: Write a failing extension request test**

Call `startDemo` directly with a mocked `fetch`. Assert the batch JSON includes exactly:

```ts
outfit_base_image_data_url: "data:image/jpeg;base64,active"
```

and does not duplicate that image in `assets`.

- [ ] **Step 3: Run RED**

```powershell
$env:PYTHONPATH='backend'
backend\.venv\Scripts\python.exe -m unittest backend.tests.test_api -v
npm.cmd --prefix extension test -- api.test.ts
```

- [ ] **Step 4: Implement the optional batch field**

Change `ProfileInput.assets` to `Field(default_factory=list, max_length=11)`. Validate an active base begins with `data:image/jpeg;base64,` or `data:image/png;base64,`, and choose:

```python
source = body.outfit_base_image_data_url or asset_by_role[mapping[0]]
started = youcam.create_clothes_task(source, product["image_url"], mapping[1])
```

During requirement checks, a valid active base satisfies `full_body_front` only for products in `LIVE_MAPPING`.

- [ ] **Step 5: Extend the extension API**

Place the new optional argument before `signal` and include it only in `/tryons/batch`:

```ts
outfit_base_image_data_url: outfitBaseImageDataUrl,
```

- [ ] **Step 6: Run GREEN and commit**

```powershell
$env:PYTHONPATH='backend'
backend\.venv\Scripts\python.exe -m unittest backend.tests.test_api -v
npm.cmd --prefix extension test -- api.test.ts
git diff --check
git add backend/app/main.py backend/tests/test_api.py extension/src/sidepanel/api.ts extension/src/sidepanel/api.test.ts
git commit -m "feat: compose try-ons from an active outfit"
```

---

### Task 5: Add active-outfit save, preview, use, and reset UI

**Files:**
- Modify: `extension/src/sidepanel/api.ts`
- Modify: `extension/src/sidepanel/App.tsx`
- Modify: `extension/src/sidepanel/App.test.tsx`
- Modify: `extension/src/sidepanel/styles.css`
- Modify: `extension/src/sidepanel/styles.test.ts`

**Interfaces:**
- Produces: `getResultImage(jobId: string, signal?: AbortSignal) -> Promise<Blob>`.
- Consumes: `loadActiveOutfit`, `saveActiveOutfit`, and `deleteActiveOutfit` from Task 2.
- Consumes: active-outfit argument on `startDemo` from Task 4.

- [ ] **Step 1: Extend the store mocks and write failing App tests**

Add tests for these observable behaviors:

```ts
it("saves a completed live result as the active outfit", async () => {
  await completeRun();
  await click("Use as active outfit");
  expect(saveActiveOutfit).toHaveBeenCalledWith(expect.any(Blob), expect.objectContaining({
    job_id: "job", product_id: "product", product_type: "dress",
  }));
  expect(host.textContent).toContain("Active outfit");
});

it("uses a saved top as the source for a later bottom", async () => {
  vi.mocked(loadActiveOutfit).mockResolvedValue(activeTop);
  // render a bottom, run, then assert the batch request
  expect(requestBody("/tryons/batch").outfit_base_image_data_url)
    .toBe("data:image/jpeg;base64,active");
});
```

Also prove mock/failed results have no save action; save failure leaves the prior outfit visible; all products share one base; reset deletes the outfit and restores profile sourcing; save/reset controls are single-flight and disabled while busy; complete-profile deletion refreshes to no active outfit.

- [ ] **Step 2: Run RED**

```powershell
npm.cmd --prefix extension test -- App.test.tsx styles.test.ts
```

- [ ] **Step 3: Add a raw-image API helper**

Implement `getResultImage` separately from the JSON helper. It uses the normal 10-second local-backend timeout, requires an OK response with `image/jpeg` or `image/png`, rejects blobs that are empty or `>= 10 * 1024 * 1024`, and returns a generic local-backend error without exposing the provider URL.

- [ ] **Step 4: Load and use the active outfit**

Include `loadActiveOutfit()` in startup and profile reload. For requirement calculation, treat a valid active outfit as satisfying `full_body_front`. When loading profile assets, omit `full_body_front` if the active outfit supplies it, then pass `activeOutfit?.image_data_url` to `startDemo`.

- [ ] **Step 5: Add save/reset UI with one mutation guard**

Use one ref-backed guard for preservation and reset. Show **Use as active outfit** only when `job.status === "completed"`, `job.mock === false`, and the result URL is valid HTTPS. On save, download through the backend, store locally, update state, and preserve the old state on error. On reset, delete locally and clear state only after success.

Render an **Active outfit** article in ready and results phases with local image, product title/type, source link, privacy copy, and **Reset to original profile photo**. Add accessible status/error messages and retain existing focus/contrast rules.

- [ ] **Step 6: Run GREEN and commit**

```powershell
npm.cmd --prefix extension test -- App.test.tsx styles.test.ts
npm.cmd --prefix extension test
npm.cmd --prefix extension run build
git diff --check
git add extension/src/sidepanel/api.ts extension/src/sidepanel/App.tsx extension/src/sidepanel/App.test.tsx extension/src/sidepanel/styles.css extension/src/sidepanel/styles.test.ts
git commit -m "feat: save and reuse an active outfit"
```

---

### Task 6: Document composition and run the complete gate

**Files:**
- Modify: `README.md`

**Interfaces:**
- Documents the user-visible contract implemented by Tasks 1-5.

- [ ] **Step 1: Update README**

Document:

- All live clothing types require a front full-body profile photo.
- **Use as active outfit** stores one rendered image browser-locally.
- Later clothing previews use that active outfit as their source.
- Products in one batch are alternatives, not an automatic chain.
- **Reset to original profile photo** removes the active outfit.
- Complete-profile deletion also removes it.
- Sequential raster editing may alter previously rendered items.
- Shoes and accessories remain future provider-specific integrations.
- Result preservation can fail after the temporary provider URL expires.
- The manual real-key smoke is top -> save -> bottom -> reset and consumes provider units.

- [ ] **Step 2: Run the complete automated gate**

```powershell
$env:PYTHONPATH='backend'
backend\.venv\Scripts\python.exe -m unittest backend.tests.test_youcam backend.tests.test_api -v
npm.cmd --prefix extension test
npm.cmd --prefix extension run build
git diff --check
git diff --check e19aa3e..HEAD
git status --short --branch
```

Expected: backend and extension suites pass, build succeeds, both diff checks print nothing, and only the intended README change remains before commit.

- [ ] **Step 3: Verify privacy and scope**

```powershell
git grep -n "YOUCAM_API_KEYS"
git grep -n -i -E "guided|camera" -- extension backend
git grep -n "result_url" -- extension/src/profile backend/app
```

Expected: no credential value; no guided-capture implementation; active-outfit metadata never contains `result_url`.

- [ ] **Step 4: Commit documentation**

```powershell
git add README.md
git commit -m "docs: explain active outfit composition"
```

- [ ] **Step 5: Review and push**

Run a task review after every task and one broad final review. After final review is clean, rerun the complete gate, push `feature/hackathon-slice`, and verify the remote branch hash equals local `HEAD`. Do not run the real-key smoke automatically.
