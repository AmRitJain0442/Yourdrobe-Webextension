# YouCam Clothing Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate live Perfect Corp YouCam previews for tops, outerwear, bottoms, and dresses through the existing local FastAPI job flow, with explicit cloud consent and deterministic API-key failover.

**Architecture:** The extension continues talking only to `127.0.0.1:8001`. A focused FastAPI-side YouCam client owns signed uploads, Clothes V3 task creation, same-key polling, safe error mapping, and ordered key failover; the existing local jobs remain the provider-neutral boundary. The browser stores only one-time cloud consent and session result state, while API keys remain backend environment values.

**Tech Stack:** Python 3.10+, FastAPI, Pydantic, httpx, unittest, Chrome Manifest V3, React 19, TypeScript 7, IndexedDB, Vitest, browser-native ImageBitmap and canvas APIs.

## Global Constraints

- Support live YouCam only for `top`, `outerwear`, `bottom`, and `dress` in this plan.
- Do not add guided or camera capture, makeup/accessory provider calls, 3D, skeletons, body tracking, authentication, databases, workers, or webhooks.
- Read backend-only keys from the exact comma-separated environment variable `YOUCAM_API_KEYS`.
- Never send API keys to Chrome, store them in job dictionaries, log them, commit them, or include them in errors.
- Rotate keys only for network failures, timeouts, HTTP 401, 403, 429, and 5xx during upload or task creation.
- Do not rotate for invalid images, unsupported parameters, malformed requests, or content-safety rejection.
- Poll an existing provider task with the same key index that created it.
- When keys are configured, live failures remain failures and never fall back to mock imagery.
- When no keys are configured, preserve the existing explicitly labelled mock flow.
- Require separate one-time Perfect Corp cloud consent and backend `cloud_consent: true` before a live task.
- Store the acknowledgement as optional `youcam_consented_at` in the existing version-2 Chrome profile metadata.
- Do not persist generated previews; keep them only in current React state.
- Do not retain input image bytes or data URLs in backend profiles or jobs after provider task creation.
- Pass retailer product `image_url` directly as YouCam `ref_file_url`; do not add a backend image proxy.
- Convert stored WebP profile assets to JPEG only on the explicit per-run upload path; leave the IndexedDB original unchanged.
- Use `httpx`, which is already installed; add no runtime dependency.
- Use test-first RED/GREEN cycles and one logical micro-commit per task.
- Treat the approved design as binding: `docs/superpowers/specs/2026-08-16-youcam-clothing-integration-design.md`.

## File Map

- Create `backend/app/youcam.py`: Perfect Corp configuration, signed upload, Clothes V3 task creation, polling, key failover, and safe provider errors.
- Create `backend/tests/test_youcam.py`: transport-level provider-client tests using `httpx.MockTransport`.
- Modify `backend/app/main.py`: capabilities contract, live batch inputs, product/profile mapping, provider-neutral job orchestration, and mock/live result mapping.
- Modify `backend/tests/test_api.py`: live API journey, cloud consent, unsupported categories, non-retention, and unchanged mock journey.
- Modify `extension/src/profile/types.ts`: optional YouCam consent timestamp.
- Modify `extension/src/profile/store.ts`: save cloud consent and produce YouCam-compatible JPEG data URLs for stored WebP assets.
- Modify `extension/src/profile/store.test.ts`: consent persistence/deletion and WebP conversion regressions.
- Create `extension/src/sidepanel/YouCamConsent.tsx`: explicit one-time Perfect Corp cloud acknowledgement.
- Create `extension/src/sidepanel/YouCamConsent.test.tsx`: blocked and accepted acknowledgement behavior.
- Modify `extension/src/types.ts`: provider result error fields.
- Modify `extension/src/sidepanel/api.ts`: capabilities lookup and live batch payload.
- Modify `extension/src/sidepanel/App.tsx`: consent gate, bounded live polling, result labels, and safe per-product failures.
- Modify `extension/src/sidepanel/App.test.tsx`: live/mock routing, cloud consent, polling, failure, and session-only behavior.
- Modify `README.md`: multi-key setup, provider modes, retention disclosure, and manual smoke procedure.

---

### Task 1: Perfect Corp Clothes V3 Client and Ordered Key Failover

**Files:**
- Create: `backend/app/youcam.py`
- Create: `backend/tests/test_youcam.py`

**Interfaces:**
- Consumes: `YOUCAM_API_KEYS`, a source such as `data:image/jpeg;base64,cGhvdG8=`, an HTTPS product reference URL, and garment category `upper_body | lower_body | full_body`.
- Produces: `YouCamClient.from_environment()`, `YouCamClient.enabled`, `YouCamClient.create_clothes_task(source_data_url, reference_url, garment_category) -> StartedTask`, and `YouCamClient.get_task(task_id, key_index) -> ProviderTaskState`.
- Produces exact immutable values:

```python
@dataclass(frozen=True)
class StartedTask:
    task_id: str
    key_index: int

@dataclass(frozen=True)
class ProviderTaskState:
    status: Literal["processing", "completed", "failed"]
    result_url: str | None = None
    error_code: str | None = None
    error_message: str | None = None

class YouCamFailure(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
```

- Uses exact provider paths `/s2s/v2.0/file/cloth-v3`, `/s2s/v2.0/task/cloth-v3`, and `/s2s/v2.0/task/cloth-v3/{task_id}` against `https://yce-api-01.makeupar.com`.

- [ ] **Step 1: Write failing configuration, upload, failover, and polling tests**

Create `backend/tests/test_youcam.py` with `unittest.TestCase` tests that build an `httpx.Client(transport=httpx.MockTransport(handler))`. The handler records method, URL, headers, and JSON bodies and returns literal provider responses.

Cover these behaviors with separate tests:

```python
def test_parses_trimmed_unique_keys(self) -> None:
    client = YouCamClient.from_value(" first ,,second,first ", self.http)
    self.assertEqual(client.key_count, 2)
    self.assertNotIn("first", repr(client))

def test_uploads_image_and_creates_clothes_v3_task(self) -> None:
    started = self.client.create_clothes_task(
        "data:image/jpeg;base64,cGhvdG8=",
        "https://images.example/dress.jpg",
        "full_body",
    )
    self.assertEqual(started, StartedTask(task_id="provider-task", key_index=0))
    self.assertEqual(self.requests[0][0:2], ("POST", "/s2s/v2.0/file/cloth-v3"))
    self.assertEqual(self.requests[1][0], "PUT")
    self.assertEqual(self.requests[2][0:2], ("POST", "/s2s/v2.0/task/cloth-v3"))
    self.assertEqual(self.requests[2][3], {
        "src_file_id": "source-file",
        "ref_file_url": "https://images.example/dress.jpg",
        "garment_category": "full_body",
    })

def test_rotates_after_retryable_creation_failure(self) -> None:
    started = self.two_key_client.create_clothes_task(
        "data:image/png;base64,cGhvdG8=",
        "https://images.example/top.png",
        "upper_body",
    )
    self.assertEqual(started.key_index, 1)
    self.assertEqual(self.authorization_headers, ["Bearer first", "Bearer second"])

def test_does_not_rotate_after_invalid_image_response(self) -> None:
    with self.assertRaisesRegex(YouCamFailure, "user image"):
        self.two_key_client.create_clothes_task(
            "data:image/jpeg;base64,cGhvdG8=",
            "https://images.example/top.jpg",
            "upper_body",
        )
    self.assertEqual(self.authorization_headers, ["Bearer first"])

def test_polls_with_creating_key_and_maps_success(self) -> None:
    state = self.two_key_client.get_task("provider-task", 1)
    self.assertEqual(state, ProviderTaskState(
        status="completed",
        result_url="https://provider.example/result.jpg",
    ))
    self.assertEqual(self.authorization_headers, ["Bearer second"])
```

Also cover invalid data URLs, unsupported WebP at the backend boundary, non-HTTPS reference URLs, all-keys-exhausted, all-keys-rate-limited, processing status, provider terminal error, safety error, and transient poll transport failure returning `processing`.

- [ ] **Step 2: Run the provider-client test and confirm RED**

Run:

```powershell
$env:PYTHONPATH='backend'
backend\.venv\Scripts\python.exe -m unittest backend.tests.test_youcam -v
```

Expected: import failure because `app.youcam` does not exist.

- [ ] **Step 3: Implement the minimal provider client**

Create `backend/app/youcam.py` with these exact public signatures:

```python
from dataclasses import dataclass
import base64
import os
from typing import Literal
from urllib.parse import urlparse

import httpx

API_BASE = "https://yce-api-01.makeupar.com"
FILE_PATH = "/s2s/v2.0/file/cloth-v3"
TASK_PATH = "/s2s/v2.0/task/cloth-v3"
RETRYABLE_HTTP = {401, 403, 429}
GarmentCategory = Literal["upper_body", "lower_body", "full_body"]

@dataclass(frozen=True)
class StartedTask:
    task_id: str
    key_index: int

@dataclass(frozen=True)
class ProviderTaskState:
    status: Literal["processing", "completed", "failed"]
    result_url: str | None = None
    error_code: str | None = None
    error_message: str | None = None

class YouCamFailure(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code

class YouCamClient:
    def __init__(self, keys: tuple[str, ...], client: httpx.Client | None = None) -> None:
        self._keys = keys
        self._client = client or httpx.Client(timeout=10.0)

    @classmethod
    def from_environment(cls) -> "YouCamClient":
        return cls.from_value(os.getenv("YOUCAM_API_KEYS", ""))

    @classmethod
    def from_value(cls, value: str, client: httpx.Client | None = None) -> "YouCamClient":
        keys = tuple(dict.fromkeys(item.strip() for item in value.split(",") if item.strip()))
        return cls(keys, client)

    @property
    def enabled(self) -> bool:
        return bool(self._keys)

    @property
    def key_count(self) -> int:
        return len(self._keys)

    def create_clothes_task(
        self,
        source_data_url: str,
        reference_url: str,
        garment_category: GarmentCategory,
    ) -> StartedTask:
        raise NotImplementedError

    def get_task(self, task_id: str, key_index: int) -> ProviderTaskState:
        raise NotImplementedError

    def __repr__(self) -> str:
        return f"YouCamClient(key_count={len(self._keys)})"
```

Complete `create_clothes_task` with one ordered loop over `_keys`. Decode the captured Base64 payload with `base64.b64decode(encoded_payload, validate=True)`, require JPEG/PNG and an HTTPS reference URL, request upload metadata, PUT the bytes to the returned signed URL using its returned headers, then create the task. Treat transport exceptions and eligible HTTP statuses as advancement to the next key. Map provider validation/safety errors immediately to `YouCamFailure` without advancing.

Complete `get_task` with exactly one key selected by `key_index`. Return `processing` for non-terminal task state and transient transport/eligible HTTP failure, `completed` only with a string result URL, and `failed` with safe local code/message for provider terminal errors. Never include response bodies, keys, or authorization headers in raised messages or `repr`.

- [ ] **Step 4: Run RED tests to GREEN**

Run:

```powershell
$env:PYTHONPATH='backend'
backend\.venv\Scripts\python.exe -m unittest backend.tests.test_youcam -v
```

Expected: all provider-client tests pass with no real network request.

- [ ] **Step 5: Run the existing backend regression suite**

Run:

```powershell
$env:PYTHONPATH='backend'
backend\.venv\Scripts\python.exe -m unittest backend.tests.test_api -v
```

Expected: the existing mock API tests remain green.

- [ ] **Step 6: Commit the provider client**

```powershell
git add -- backend/app/youcam.py backend/tests/test_youcam.py
git commit -m "feat: add YouCam clothes client"
```

---

### Task 2: Live Backend Job Orchestration and Provider-Neutral Contracts

**Files:**
- Modify: `backend/app/main.py:1-217`
- Modify: `backend/tests/test_api.py:1-252`

**Interfaces:**
- Consumes Task 1: `YouCamClient`, `StartedTask`, `ProviderTaskState`, and `YouCamFailure`.
- Produces: `GET /v1/capabilities` with exact live response `{ "tryon_provider": "youcam", "live_product_types": ["top", "outerwear", "bottom", "dress"] }` and exact mock response `{ "tryon_provider": "mock", "live_product_types": [] }`.
- Extends `BatchInput` with `assets: list[ProfileAssetInput] = []` and `cloud_consent: bool = False`.
- Stores live jobs with `provider_task_id` and `provider_key_index`, never input data URLs or keys.
- Preserves current endpoint paths and mock responses when no keys are configured.

- [ ] **Step 1: Add failing live API journey tests**

In `backend/tests/test_api.py`, import the `app.main` module as `main`, save `main.youcam` in `setUp`, replace it with a disabled fake by default, and restore it in `tearDown`. Use a small fake that implements the Task 1 interface:

```python
class FakeYouCam:
    def __init__(self) -> None:
        self.enabled = True
        self.created: list[tuple[str, str, str]] = []
        self.polled: list[tuple[str, int]] = []

    def create_clothes_task(self, source: str, reference: str, category: str) -> StartedTask:
        self.created.append((source, reference, category))
        return StartedTask("provider-task", 1)

    def get_task(self, task_id: str, key_index: int) -> ProviderTaskState:
        self.polled.append((task_id, key_index))
        return ProviderTaskState("completed", "https://provider.example/result.jpg")
```

Add focused tests for:

```python
def test_capabilities_report_live_clothing_types(self) -> None:
    main.youcam = FakeYouCam()
    self.assertEqual(self.client.get("/v1/capabilities").json(), {
        "tryon_provider": "youcam",
        "live_product_types": ["top", "outerwear", "bottom", "dress"],
    })

def test_live_dress_creates_and_polls_provider_job(self) -> None:
    main.youcam = FakeYouCam()
    response = self.client.post("/v1/tryons/batch", json={
        "session_id": self.session_id,
        "profile_id": self.full_body_profile_id,
        "product_ids": [self.dress_product_id],
        "assets": [{"kind": "full_body_front", "image_data_url": "data:image/jpeg;base64,cGhvdG8="}],
        "cloud_consent": True,
    })
    job_id = response.json()["jobs"][0]["job_id"]
    result = self.client.get(f"/v1/tryons/{job_id}").json()
    self.assertEqual(result["status"], "completed")
    self.assertEqual(result["result_url"], "https://provider.example/result.jpg")
    self.assertFalse(result["mock"])
    self.assertNotIn("cGhvdG8", repr(jobs[job_id]))
    self.assertNotIn("Bearer", repr(jobs[job_id]))

def test_live_batch_requires_cloud_consent(self) -> None:
    main.youcam = FakeYouCam()
    response = self.client.post("/v1/tryons/batch", json=self.live_batch(cloud_consent=False))
    self.assertEqual(response.status_code, 400)
    self.assertEqual(response.json()["detail"]["code"], "live_consent_required")

def test_unsupported_live_category_is_failed_without_provider_call(self) -> None:
    provider = FakeYouCam()
    main.youcam = provider
    job = self.client.post("/v1/tryons/batch", json=self.makeup_batch()).json()["jobs"][0]
    self.assertEqual(job["status"], "failed")
    self.assertEqual(job["error_code"], "unsupported_live_category")
    self.assertEqual(provider.created, [])
```

Also test top/outerwear -> `upper_body`, bottom -> `lower_body`, dress -> `full_body`, missing live batch asset -> existing `missing_profile_assets` structure, `YouCamFailure` -> failed local job without mock, and unchanged mock behavior/capabilities when disabled.

- [ ] **Step 2: Run the focused API tests and confirm RED**

Run:

```powershell
$env:PYTHONPATH='backend'
backend\.venv\Scripts\python.exe -m unittest backend.tests.test_api -v
```

Expected: failures for the missing `youcam` global, capabilities endpoint, live batch fields, and provider jobs.

- [ ] **Step 3: Add the minimal live contracts and job mapping**

In `backend/app/main.py`, import Task 1 values and initialize once at process start:

```python
from app.youcam import ProviderTaskState, YouCamClient, YouCamFailure

youcam = YouCamClient.from_environment()
LIVE_TYPES = ["top", "outerwear", "bottom", "dress"]
LIVE_MAPPING = {
    "top": ("upper_body_front", "upper_body"),
    "outerwear": ("upper_body_front", "upper_body"),
    "bottom": ("full_body_front", "lower_body"),
    "dress": ("full_body_front", "full_body"),
}
```

Extend `BatchInput` exactly:

```python
class BatchInput(BaseModel):
    session_id: str
    profile_id: str
    product_ids: list[str] = Field(min_length=1, max_length=5)
    assets: list[ProfileAssetInput] = Field(default_factory=list, max_length=11)
    cloud_consent: bool = False
```

Add:

```python
@app.get("/v1/capabilities")
def capabilities() -> dict[str, object]:
    return {
        "tryon_provider": "youcam" if youcam.enabled else "mock",
        "live_product_types": LIVE_TYPES if youcam.enabled else [],
    }
```

Keep the current role validation before provider work. In `create_tryons`, branch once on `youcam.enabled`. The disabled branch stays byte-for-byte behaviorally equivalent to the current mock creation. The live branch requires `cloud_consent`, indexes unique `body.assets` by role, creates an immediate failed job for product types absent from `LIVE_MAPPING`, and otherwise calls `create_clothes_task`. Store only:

```python
{
    "job_id": job_id,
    "product_id": product_id,
    "provider_task_id": started.task_id,
    "provider_key_index": started.key_index,
    "mock": False,
}
```

Map `YouCamFailure` into a failed job with its safe `code` and message. Never insert `body.assets`, `image_data_url`, or an environment key into `jobs`.

In `get_tryon`, return existing mock timing behavior when `job["mock"]` is true, return stored immediate failures, otherwise call `youcam.get_task` and map `ProviderTaskState` into the existing job response shape. Include `mock: False` for completed/failed live results.

- [ ] **Step 4: Run backend tests to GREEN**

Run:

```powershell
$env:PYTHONPATH='backend'
backend\.venv\Scripts\python.exe -m unittest backend.tests.test_youcam backend.tests.test_api -v
```

Expected: provider-client and API suites pass without network access.

- [ ] **Step 5: Commit live backend orchestration**

```powershell
git add -- backend/app/main.py backend/tests/test_api.py
git commit -m "feat: run clothing try-ons with YouCam"
```

---

### Task 3: Browser Cloud Consent and Provider-Compatible Profile Assets

**Files:**
- Modify: `extension/src/profile/types.ts:1-55`
- Modify: `extension/src/profile/store.ts:1-210`
- Modify: `extension/src/profile/store.test.ts:1-330`
- Create: `extension/src/sidepanel/YouCamConsent.tsx`
- Create: `extension/src/sidepanel/YouCamConsent.test.tsx`

**Interfaces:**
- Produces optional `ProfileMetadata.youcam_consented_at?: string`.
- Produces `saveYouCamConsent(): Promise<ProfileMetadata>`; it requires existing version-2 metadata and writes an ISO timestamp through the existing profile lock.
- Keeps `loadRequiredAssets(roles)` signature unchanged but guarantees returned data URLs use JPEG/PNG; stored WebP is converted to JPEG without replacing IndexedDB.
- Produces `YouCamConsent({ busy, error, onAccept, onCancel })` with an explicit unchecked acknowledgement.

- [ ] **Step 1: Write failing metadata, WebP conversion, and consent component tests**

In `extension/src/profile/store.test.ts`, add:

```typescript
it("records separate YouCam consent only on an existing profile", async () => {
  await saveAttributes({ top_size: "M" });
  const result = await saveYouCamConsent();
  expect(result.youcam_consented_at).toBe("2026-08-16T00:00:00.000Z");
  expect((await loadProfile())?.youcam_consented_at).toBe("2026-08-16T00:00:00.000Z");
});

it("does not manufacture a profile while recording YouCam consent", async () => {
  await expect(saveYouCamConsent()).rejects.toThrow("Create your local profile first.");
  expect(await loadProfile()).toBeNull();
});

it("converts stored WebP to JPEG only for a provider upload", async () => {
  await saveAsset(face(new Blob(["webp"], { type: "image/webp" })));
  const uploads = await loadRequiredAssets(["face_front"]);
  expect(uploads[0].image_data_url).toBe("data:image/jpeg;base64,anBlZw==");
  expect((await rawAsset("face_front"))?.type).toBe("image/webp");
});
```

Use existing deterministic time setup or stub `Date` so the first test asserts a literal ISO timestamp. Stub `HTMLCanvasElement.prototype.getContext` and `toBlob` only for the WebP test; return a JPEG `Blob(["jpeg"], { type: "image/jpeg" })`.

Create `YouCamConsent.test.tsx` with real DOM behavior:

```typescript
it("requires the Perfect Corp acknowledgement before accepting", async () => {
  const onAccept = vi.fn();
  await act(async () => root.render(<YouCamConsent busy={false} error="" onAccept={onAccept} onCancel={vi.fn()} />));
  const accept = screenButton("Agree and create live preview");
  expect(host.textContent).toContain("Perfect Corp");
  expect(host.textContent).toContain("up to 30 days");
  expect(accept.disabled).toBe(true);
  await act(async () => (host.querySelector('input[type="checkbox"]') as HTMLInputElement).click());
  expect(accept.disabled).toBe(false);
  await act(async () => accept.click());
  expect(onAccept).toHaveBeenCalledOnce();
});
```

Also assert the component does not mention camera capture, disables both controls while busy, renders `error` with `role="alert"`, and never displays an API-key field.

- [ ] **Step 2: Run focused tests and confirm RED**

Run:

```powershell
npm.cmd --prefix extension test -- src/profile/store.test.ts src/sidepanel/YouCamConsent.test.tsx
```

Expected: missing export/type/component failures.

- [ ] **Step 3: Implement metadata consent and WebP conversion**

Add to `ProfileMetadata`:

```typescript
youcam_consented_at?: string;
```

Add to `store.ts` through the existing `withProfileLock` and `saveMetadata` path:

```typescript
export function saveYouCamConsent(): Promise<ProfileMetadata> {
  return withProfileLock(async () => {
    const profile = await loadProfile();
    if (!profile) throw new Error("Create your local profile first.");
    const next = { ...profile, youcam_consented_at: new Date().toISOString() };
    await saveMetadata(next);
    return next;
  });
}
```

Inside `loadRequiredAssets`, after validating the bitmap, use the original blob for JPEG/PNG. For WebP only, draw the existing bitmap into a same-size canvas and encode with `canvas.toBlob(callback, "image/jpeg", 0.9)`. Pass the transient JPEG blob to `dataUrl`; never write it to IndexedDB or metadata. Keep bitmap cleanup in the existing `finally`.

- [ ] **Step 4: Implement the focused consent component**

Create `YouCamConsent.tsx` with exact props:

```typescript
type Props = {
  busy: boolean;
  error: string;
  onAccept: () => void;
  onCancel: () => void;
};

export function YouCamConsent({ busy, error, onAccept, onCancel }: Props) {
  const [accepted, setAccepted] = useState(false);
  return <section aria-busy={busy}>
    <h2>Enable live YouCam previews</h2>
    <p>The required profile photo and retailer product image will be sent to Perfect Corp for this live preview.</p>
    <p>Perfect Corp may retain uploaded and generated assets for up to 30 days. Yourdrobe keeps the generated preview only in this side-panel session.</p>
    <label className="check"><input type="checkbox" disabled={busy} checked={accepted} onChange={(event) => setAccepted(event.target.checked)} />I agree to Perfect Corp cloud processing for live YouCam previews.</label>
    <button type="button" disabled={busy || !accepted} onClick={onAccept}>Agree and create live preview</button>
    <button type="button" className="secondary" disabled={busy} onClick={onCancel}>Cancel</button>
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}
```

- [ ] **Step 5: Run focused and full extension tests**

Run:

```powershell
npm.cmd --prefix extension test -- src/profile/store.test.ts src/sidepanel/YouCamConsent.test.tsx
npm.cmd --prefix extension test
npm.cmd --prefix extension run build
```

Expected: focused tests, all extension tests, and TypeScript/Vite build pass.

- [ ] **Step 6: Commit consent and asset preparation**

```powershell
git add -- extension/src/profile/types.ts extension/src/profile/store.ts extension/src/profile/store.test.ts extension/src/sidepanel/YouCamConsent.tsx extension/src/sidepanel/YouCamConsent.test.tsx
git commit -m "feat: prepare profiles for YouCam"
```

---

### Task 4: Live Extension Flow, Bounded Polling, and Result UI

**Files:**
- Modify: `extension/src/types.ts:1-34`
- Modify: `extension/src/sidepanel/api.ts:1-76`
- Modify: `extension/src/sidepanel/App.tsx:1-170`
- Modify: `extension/src/sidepanel/App.test.tsx:1-225`
- Modify: `extension/src/sidepanel/styles.css:1-90`

**Interfaces:**
- Consumes Task 2 `GET /v1/capabilities` and extended batch payload.
- Consumes Task 3 `saveYouCamConsent` and `YouCamConsent`.
- Produces `getCapabilities(signal?) -> { tryon_provider, live_product_types }`.
- Changes `startDemo` to accept exact `cloudConsent: boolean` before `signal` and include `assets` plus `cloud_consent` in `/tryons/batch`.
- Extends `TryOnJob` with `error_code?: string`, `error_message?: string`, and preserves `mock?: boolean`.
- Polls every `2_000` ms for at most `40` attempts.

- [ ] **Step 1: Add failing API payload, consent-routing, polling, and result tests**

In `App.test.tsx`, extend the store mock with `saveYouCamConsent`. Add literal capabilities responses to fetch fixtures.

Cover:

```typescript
it("requests one-time YouCam consent before the first live clothing run", async () => {
  vi.mocked(loadProfile).mockResolvedValue(fullBodyProfile);
  mockCapabilities("youcam", ["dress"]);
  await renderApp();
  await click("Try these products");
  expect(host.textContent).toContain("Enable live YouCam previews");
  expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith("/tryons/batch"))).toBe(false);
});

it("records consent and resumes the live run", async () => {
  const consented = { ...fullBodyProfile, youcam_consented_at: "2026-08-16T00:00:00.000Z" };
  vi.mocked(saveYouCamConsent).mockResolvedValue(consented);
  mockCapabilities("youcam", ["dress"]);
  await renderApp();
  await click("Try these products");
  await checkYouCamConsentAndAccept();
  const batch = requestBody("/tryons/batch");
  expect(batch.assets).toEqual([{ kind: "full_body_front", image_data_url: "data:image/png;base64,profile" }]);
  expect(batch.cloud_consent).toBe(true);
});

it("does not repeat consent for an already-consented profile", async () => {
  vi.mocked(loadProfile).mockResolvedValue({ ...fullBodyProfile, youcam_consented_at: "2026-08-16T00:00:00.000Z" });
  mockCapabilities("youcam", ["dress"]);
  await renderApp();
  await click("Try these products");
  expect(host.textContent).not.toContain("Enable live YouCam previews");
  expect(requestBody("/tryons/batch").cloud_consent).toBe(true);
});

it("labels completed live results without a mock fallback", async () => {
  mockCompletedJob({ mock: false, result_url: "https://provider.example/result.jpg" });
  await completeRun();
  expect(host.textContent).toContain("YouCam AI preview");
  expect(host.textContent).not.toContain("Mock AI preview");
  expect(JSON.stringify((chrome.storage.local.set as ReturnType<typeof vi.fn>).mock.calls)).not.toContain("provider.example/result.jpg");
});

it("shows the provider failure and original listing", async () => {
  mockCompletedJob({ status: "failed", mock: false, error_code: "invalid_product_image", error_message: "YouCam could not use this product image." });
  await completeRun();
  expect(host.textContent).toContain("YouCam could not use this product image.");
  expect(host.textContent).not.toContain("Mock AI preview");
  expect(host.querySelector('a[href="https://amazon.in/dp/DRESS"]')).not.toBeNull();
});
```

Add fake-timer tests proving a processing job is polled on a two-second interval, stops after 40 polls with the existing timeout message, and aborts without another poll after component unmount. Keep a mock-capabilities test proving `cloud_consent: false` and the `Mock AI preview` label remain.

- [ ] **Step 2: Run focused App tests and confirm RED**

Run:

```powershell
npm.cmd --prefix extension test -- src/sidepanel/App.test.tsx
```

Expected: failures for missing capability lookup, consent phase, batch fields, polling constants, and live label.

- [ ] **Step 3: Extend API types and calls**

Add to `TryOnJob`:

```typescript
error_code?: string;
error_message?: string;
```

In `api.ts`, replace the existing `../types` import and add the capability contract:

```typescript
import type { Product, ProductType, TryOnJob } from "../types";

export type Capabilities = {
  tryon_provider: "mock" | "youcam";
  live_product_types: ProductType[];
};

export const getCapabilities = (signal?: AbortSignal) =>
  json<Capabilities>("/capabilities", { signal });
```

Change `startDemo` to:

```typescript
export async function startDemo(
  assets: ProfileAssetUpload[],
  attributes: ProfileAttributes,
  products: Product[],
  cloudConsent: boolean,
  signal?: AbortSignal,
)
```

Keep the existing session/profile/normalize sequence. Add `assets` and `cloud_consent: cloudConsent` to the batch JSON body.

- [ ] **Step 4: Wire cloud consent and live jobs into App**

Add `"youcam-consent"` to `Phase`, import Task 3 values, and set:

```typescript
const maxPolls = 40;
const pollDelayMs = 2_000;
```

Split the current run path into a small capability gate and the existing request body. Resolve missing local requirements before capability lookup. When capabilities are live and `profile.youcam_consented_at` is absent, render `YouCamConsent` and do not call `startDemo`. On acceptance, await `saveYouCamConsent`, update profile state, and restart the same run with the returned metadata. Pass `Boolean(currentProfile?.youcam_consented_at)` as `cloudConsent`.

Replace the hard-coded badge with:

```tsx
<span className="badge">{job.mock === false ? "YouCam AI preview" : "Mock AI preview"}</span>
```

For failed jobs, render `job.error_message ?? "This product preview failed. You can still view the original listing."`. Keep the original listing link for every result. Do not add result persistence or any camera UI.

Add only the spacing needed for the consent section to `styles.css`; reuse existing button, check, error, and focus styles.

- [ ] **Step 5: Run focused tests, full extension tests, and build**

Run:

```powershell
npm.cmd --prefix extension test -- src/sidepanel/App.test.tsx src/sidepanel/YouCamConsent.test.tsx
npm.cmd --prefix extension test
npm.cmd --prefix extension run build
```

Expected: live/mock UI tests, full suite, TypeScript, and Vite build pass.

- [ ] **Step 6: Commit the live extension journey**

```powershell
git add -- extension/src/types.ts extension/src/sidepanel/api.ts extension/src/sidepanel/App.tsx extension/src/sidepanel/App.test.tsx extension/src/sidepanel/styles.css
git commit -m "feat: show live YouCam clothing previews"
```

---

### Task 5: Setup, Privacy, and Real-Key Smoke Documentation

**Files:**
- Modify: `README.md:1-82`

**Interfaces:**
- Documents exact PowerShell multi-key configuration without storing keys in files.
- Distinguishes mock mode from live mode and states that live failures never become mock previews.
- Documents Perfect Corp 30-day asset removal and two-hour result URL behavior.
- Documents clothing-only live scope and explicitly says guided capture remains absent.

- [ ] **Step 1: Update backend startup instructions**

Add a live-mode block before starting Uvicorn:

```powershell
$env:YOUCAM_API_KEYS='first-api-key,second-api-key'
$env:PYTHONPATH='backend'
backend/.venv/Scripts/python.exe -m uvicorn app.main:app --reload --port 8001
```

State that values are tried in order, must never be committed, and remain only in the backend process environment. Add mock-mode cleanup:

```powershell
Remove-Item Env:YOUCAM_API_KEYS -ErrorAction SilentlyContinue
```

- [ ] **Step 2: Replace stale mock-only and privacy statements**

Document:

- live YouCam scope is top, outerwear, bottom, and dress;
- unsupported categories show a failure in live mode;
- `Mock AI preview` appears only when no keys are configured;
- configured live failures never fall back to mock imagery;
- the first live run requires separate Perfect Corp consent;
- Perfect Corp may retain uploaded/generated assets for up to 30 days;
- generated URLs expire after two hours and Yourdrobe does not persist them;
- profile creation remains file-upload-only and guided capture is not implemented.

Link the official Clothes API and retention documentation from the approved design.

- [ ] **Step 3: Add a manual real-key smoke procedure**

Document one supported clothing listing smoke check:

1. Configure one real key and start the backend.
2. Build/reload the extension.
3. Open a supported top or dress listing.
4. Upload the required file and accept cloud processing.
5. Confirm the result is labelled `YouCam AI preview` and the source listing remains accessible.
6. Repeat with an intentionally invalid first key followed by the valid key; confirm the valid key succeeds without exposing either key.
7. Confirm an invalid product image shows a failure and not `Mock AI preview`.

State that the smoke test consumes provider units and is never run in CI.

- [ ] **Step 4: Run complete verification**

Run from the repository root:

```powershell
$env:PYTHONPATH='backend'
backend\.venv\Scripts\python.exe -m unittest backend.tests.test_youcam backend.tests.test_api -v
npm.cmd --prefix extension test
npm.cmd --prefix extension run build
git diff --check
git status --short --branch
```

Expected: both backend modules pass without network access, all extension tests pass, production build succeeds, diff check prints nothing, and only the intended README change is uncommitted.

- [ ] **Step 5: Commit documentation**

```powershell
git add -- README.md
git commit -m "docs: explain live YouCam clothing previews"
```

---

## Final Verification and Review

- [ ] Run the complete backend, extension, build, and diff commands from Task 5 again on committed HEAD.
- [ ] Inspect `git log --oneline` and confirm five implementation micro-commits follow the design and plan commits.
- [ ] Confirm `git grep -n "YOUCAM_API_KEYS"` finds configuration access and documentation only, never a key value.
- [ ] Confirm `git grep -n -i "guided\|camera" -- extension backend` finds no new guided-capture implementation.
- [ ] Confirm `repr(profiles)` and `repr(jobs)` tests prove that data URLs and raw keys are absent after task creation.
- [ ] Run a broad read-only review over the plan's base-to-head range; fix every Critical or Important finding before push.
- [ ] Push `feature/hackathon-slice` only after the final review and fresh verification are clean.
