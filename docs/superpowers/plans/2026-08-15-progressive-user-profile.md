# Progressive User Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single generic profile photo with a progressive, browser-local multi-photo profile for makeup, clothing, accessories, jewellery, bags, and footwear while preserving the mocked try-on flow.

**Architecture:** Fine-grained product types map to photo requirements through pure TypeScript helpers. Chrome metadata stays in `chrome.storage.local`, image blobs live in native IndexedDB, and only the assets needed for the current product batch are converted to data URLs and sent to the local FastAPI process. The backend validates asset roles and product requirements but stores only bounded role metadata, never image bytes or optional attributes.

**Tech Stack:** Chrome Manifest V3, React 19, TypeScript 7, IndexedDB, Vitest/jsdom, FastAPI, Pydantic, Python `unittest`.

## Global Constraints

- Ask for a photo only when the current product needs it.
- Accept JPEG, PNG, and WebP source files no larger than 10 MB.
- Require the exact role-specific minimum dimensions from the approved specification.
- Normalize oversized images with native Canvas to a maximum 2048-pixel edge and target size no greater than 2 MB.
- Persist image blobs only in browser IndexedDB and lightweight metadata only in `chrome.storage.local`.
- Send only required images to `http://127.0.0.1:8001` during an explicit try-on run.
- Do not persist image bytes, file names, or optional attributes in the backend.
- Do not infer body, face, skin-tone, pose, or measurement data.
- Preserve the old `yourdrobe_profile_image` value until migration succeeds or the user deletes it.
- Add no runtime dependency for profile storage or image processing.
- Keep all previews labelled `Mock AI preview`.
- Do not add YouCam, guided camera capture, cloud storage, authentication, 3D, or skeleton code in this plan.
- End every task with its own focused test run and micro commit.

---

## File structure

- Modify `extension/src/types.ts`: add `ProductType` and `product_type` without removing the existing broad category.
- Create `extension/src/product-type.ts`: classify product titles into fine-grained types.
- Create `extension/src/product-type.test.ts`: cover deterministic classification and unknown fallback.
- Create `extension/src/profile/types.ts`: define photo roles, requirement keys, metadata, attributes, and upload payloads.
- Create `extension/src/profile/requirements.ts`: map product types to alternative photo roles and compute missing requirements.
- Create `extension/src/profile/requirements.test.ts`: cover progressive requirement resolution.
- Create `extension/src/profile/image.ts`: validate and normalize uploaded images with browser-native APIs.
- Create `extension/src/profile/image.test.ts`: cover type, size, dimensions, and normalization.
- Create `extension/src/profile/store.ts`: own IndexedDB blobs, Chrome metadata, legacy assignment, replacement, and deletion.
- Create `extension/src/profile/store.test.ts`: verify storage and migration using test-only IndexedDB emulation.
- Create `extension/src/sidepanel/ProfileSetup.tsx`: collect only missing photo roles.
- Create `extension/src/sidepanel/ProfileSetup.test.tsx`: cover upload validation, hand-side choice, consent, and save behavior.
- Create `extension/src/sidepanel/ProfileManager.tsx`: replace/delete assets and edit optional attributes.
- Create `extension/src/sidepanel/ProfileManager.test.tsx`: cover legacy assignment and destructive profile deletion.
- Modify `extension/src/content/adapters/*.ts`: attach fine-grained product types.
- Modify `extension/src/content/adapters/adapters.test.ts`: verify product typing without weakening extraction checks.
- Modify `extension/src/sidepanel/App.tsx`: load profile metadata, open progressive setup, and manage the profile.
- Modify `extension/src/sidepanel/App.test.tsx`: cover progressive routing and the completed mock journey.
- Modify `extension/src/sidepanel/api.ts`: send multi-asset profiles and surface structured missing-role responses.
- Modify `extension/src/sidepanel/styles.css`: style the upload and profile-management states using existing tokens.
- Modify `backend/app/main.py`: accept multiple assets, retain only role sets, and validate job requirements.
- Modify `backend/tests/test_api.py`: cover privacy, validation, and category requirements.
- Modify `README.md`: document progressive profiles, local storage, deletion, and the unchanged mock boundary.

---

### Task 1: Product taxonomy and profile requirement resolver

**Files:**
- Modify: `extension/src/types.ts`
- Create: `extension/src/product-type.ts`
- Create: `extension/src/product-type.test.ts`
- Create: `extension/src/profile/types.ts`
- Create: `extension/src/profile/requirements.ts`
- Create: `extension/src/profile/requirements.test.ts`
- Modify: `extension/src/content/adapters/amazon.ts`
- Modify: `extension/src/content/adapters/flipkart.ts`
- Modify: `extension/src/content/adapters/nykaa.ts`
- Modify: `extension/src/content/adapters/adapters.test.ts`

**Interfaces:**
- Produces: `classifyProductType(title: string, category: Product["category"]): ProductType`
- Produces: `requirementsForProducts(products: Product[]): RequirementKey[]`
- Produces: `missingRequirements(products: Product[], available: Iterable<PhotoRole>): RequirementKey[]`
- Produces: `rolesForRequirement(requirement: RequirementKey): readonly PhotoRole[]`
- Consumes: existing `Product.category` and adapter titles.

- [ ] **Step 1: Add failing product-classification tests**

```ts
import { describe, expect, it } from "vitest";
import { classifyProductType } from "./product-type";

describe("classifyProductType", () => {
  it.each([
    ["Ruby lipstick", "makeup", "makeup"],
    ["Polarized sunglasses", "other", "eyewear"],
    ["Gold hoop earrings", "other", "earrings"],
    ["Linen dress", "apparel", "dress"],
    ["Leather wrist watch", "other", "watch"],
    ["Running shoes", "other", "footwear"],
  ] as const)("classifies %s", (title, category, expected) => {
    expect(classifyProductType(title, category)).toBe(expected);
  });

  it("does not guess an unrelated product type", () => {
    expect(classifyProductType("Daily essential", "other")).toBe("unknown");
  });
});
```

- [ ] **Step 2: Run the classification test and verify RED**

Run:

```powershell
extension\node_modules\.bin\vitest.cmd run src/product-type.test.ts
```

Expected: FAIL because `product-type.ts` does not exist.

- [ ] **Step 3: Add the product and profile types**

Add to `extension/src/types.ts`:

```ts
export type ProductType =
  | "makeup" | "eyewear" | "headwear" | "earrings" | "necklace"
  | "top" | "outerwear" | "dress" | "bottom" | "belt" | "bag"
  | "watch" | "bracelet" | "ring" | "footwear" | "unknown";

export type Product = {
  id?: string;
  platform: "amazon_in" | "amazon_us" | "flipkart" | "nykaa";
  title: string;
  brand?: string;
  price?: number;
  currency?: "INR" | "USD";
  category: "apparel" | "makeup" | "other";
  product_type?: ProductType;
  image_url: string;
  product_url: string;
  metadata: { shade?: string; color?: string };
};
```

Create `extension/src/profile/types.ts` with these exact public types:

```ts
export type PhotoRole =
  | "face_front" | "face_left" | "face_right"
  | "upper_body_front" | "upper_body_side"
  | "full_body_front" | "full_body_side"
  | "left_hand_wrist" | "right_hand_wrist"
  | "feet_front" | "feet_side_top";

export type RequirementKey =
  | "face_front" | "upper_body_front" | "full_body_front"
  | "hand_wrist" | "feet_front";

export type ProfileAssetMetadata = {
  role: PhotoRole;
  mime_type: "image/jpeg" | "image/png" | "image/webp";
  width: number;
  height: number;
  byte_size: number;
  updated_at: string;
};

export type ProfileAttributes = {
  height_cm?: number;
  top_size?: string;
  bottom_size?: string;
  dress_size?: string;
  chest_cm?: number;
  waist_cm?: number;
  hips_cm?: number;
  inseam_cm?: number;
  skin_tone?: string;
  undertone?: string;
  shoe_size_system?: string;
  shoe_size?: string;
  ring_size?: string;
  left_wrist_cm?: number;
  right_wrist_cm?: number;
};

export type ProfileMetadata = {
  version: 2;
  consented_at: string;
  assets: Partial<Record<PhotoRole, ProfileAssetMetadata>>;
  attributes: ProfileAttributes;
};

export type PreparedProfileImage = {
  blob: Blob;
  metadata: ProfileAssetMetadata;
};

export type ProfileAssetUpload = {
  kind: PhotoRole;
  image_data_url: string;
};
```

- [ ] **Step 4: Implement deterministic title classification**

Create `extension/src/product-type.ts` with an ordered table. Specific accessory and full-body matches must run before the broad apparel fallback:

```ts
import type { Product, ProductType } from "./types";

const rules: Array<[RegExp, ProductType]> = [
  [/lipstick|foundation|concealer|blush|mascara|eyeliner|makeup/i, "makeup"],
  [/sunglass|eyeglass|spectacle|frame/i, "eyewear"],
  [/hat|cap|beanie|headband/i, "headwear"],
  [/earring|stud|hoop/i, "earrings"],
  [/necklace|pendant|chain/i, "necklace"],
  [/watch/i, "watch"],
  [/bracelet|bangle/i, "bracelet"],
  [/ring/i, "ring"],
  [/shoe|sneaker|sandal|heel|boot|slipper|loafer/i, "footwear"],
  [/dress|gown|saree|jumpsuit/i, "dress"],
  [/jean|trouser|pant|skirt|shorts|legging/i, "bottom"],
  [/jacket|coat|blazer|hoodie/i, "outerwear"],
  [/shirt|t-?shirt|top|kurta|blouse|sweater/i, "top"],
  [/belt/i, "belt"],
  [/handbag|shoulder bag|backpack|purse|clutch/i, "bag"],
];

export function classifyProductType(title: string, category: Product["category"]): ProductType {
  for (const [pattern, type] of rules) if (pattern.test(title)) return type;
  return category === "makeup" ? "makeup" : "unknown";
}
```

- [ ] **Step 5: Add failing requirement-resolution tests**

```ts
import { describe, expect, it } from "vitest";
import type { Product } from "../types";
import { missingRequirements, requirementsForProducts, rolesForRequirement } from "./requirements";

const product = (product_type: Product["product_type"]): Product => ({
  platform: "amazon_in", title: String(product_type), category: "other",
  product_type, image_url: "https://img.example/item.jpg",
  product_url: "https://amazon.in/dp/ITEM", metadata: {},
});

describe("profile requirements", () => {
  it("deduplicates a mixed batch in stable order", () => {
    expect(requirementsForProducts([
      product("makeup"), product("eyewear"), product("dress"), product("watch"), product("footwear"),
    ])).toEqual(["face_front", "full_body_front", "hand_wrist", "feet_front"]);
  });

  it("accepts either hand for jewellery", () => {
    expect(missingRequirements([product("ring")], ["right_hand_wrist"])).toEqual([]);
    expect(rolesForRequirement("hand_wrist")).toEqual(["left_hand_wrist", "right_hand_wrist"]);
  });

  it("returns only unsatisfied requirements", () => {
    expect(missingRequirements([product("top"), product("dress")], ["upper_body_front"]))
      .toEqual(["full_body_front"]);
  });
});
```

- [ ] **Step 6: Run the resolver test and verify RED**

Run:

```powershell
extension\node_modules\.bin\vitest.cmd run src/profile/requirements.test.ts
```

Expected: FAIL because `requirements.ts` does not exist.

- [ ] **Step 7: Implement the requirement map**

Create `extension/src/profile/requirements.ts`:

```ts
import type { Product, ProductType } from "../types";
import type { PhotoRole, RequirementKey } from "./types";

const requirements: Partial<Record<ProductType, RequirementKey>> = {
  makeup: "face_front", eyewear: "face_front", headwear: "face_front", earrings: "face_front",
  necklace: "upper_body_front", top: "upper_body_front", outerwear: "upper_body_front",
  dress: "full_body_front", bottom: "full_body_front", belt: "full_body_front", bag: "full_body_front",
  watch: "hand_wrist", bracelet: "hand_wrist", ring: "hand_wrist", footwear: "feet_front",
};

const alternatives: Record<RequirementKey, readonly PhotoRole[]> = {
  face_front: ["face_front"],
  upper_body_front: ["upper_body_front"],
  full_body_front: ["full_body_front"],
  hand_wrist: ["left_hand_wrist", "right_hand_wrist"],
  feet_front: ["feet_front"],
};

export const rolesForRequirement = (key: RequirementKey) => alternatives[key];

export function requirementsForProducts(products: Product[]): RequirementKey[] {
  const result: RequirementKey[] = [];
  for (const product of products) {
    const requirement = requirements[product.product_type ?? "unknown"];
    if (requirement && !result.includes(requirement)) result.push(requirement);
  }
  return result;
}

export function missingRequirements(products: Product[], available: Iterable<PhotoRole>): RequirementKey[] {
  const roles = new Set(available);
  return requirementsForProducts(products).filter((requirement) =>
    !rolesForRequirement(requirement).some((role) => roles.has(role)),
  );
}
```

- [ ] **Step 8: Add product types to adapters**

In each adapter, create the product object as today and add:

```ts
product_type: classifyProductType(title, category),
```

Extend `adapters.test.ts` assertions so the existing shirt, dress, and lipstick fixtures assert `top`, `dress`, and `makeup`. Add one accessory fixture for `watch`.

- [ ] **Step 9: Run focused and full extension tests**

Run:

```powershell
extension\node_modules\.bin\vitest.cmd run src/product-type.test.ts src/profile/requirements.test.ts src/content/adapters/adapters.test.ts
npm.cmd --prefix extension test
```

Expected: all tests PASS.

- [ ] **Step 10: Commit the taxonomy micro change**

```powershell
git add extension/src/types.ts extension/src/product-type.ts extension/src/product-type.test.ts extension/src/profile/types.ts extension/src/profile/requirements.ts extension/src/profile/requirements.test.ts extension/src/content/adapters
git commit -m "feat: resolve product profile requirements"
```

---

### Task 2: Browser-local image validation and profile storage

**Files:**
- Create: `extension/src/profile/image.ts`
- Create: `extension/src/profile/image.test.ts`
- Create: `extension/src/profile/store.ts`
- Create: `extension/src/profile/store.test.ts`
- Modify: `extension/package.json`
- Modify: `extension/package-lock.json`

**Interfaces:**
- Consumes: `PhotoRole`, `PreparedProfileImage`, `ProfileMetadata`, and `ProfileAssetUpload` from Task 1.
- Produces: `prepareProfileImage(file: File, role: PhotoRole): Promise<PreparedProfileImage>`
- Produces: `loadProfile(): Promise<ProfileMetadata | null>`
- Produces: `saveAsset(image: PreparedProfileImage): Promise<ProfileMetadata>`
- Produces: `loadRequiredAssets(roles: PhotoRole[]): Promise<ProfileAssetUpload[]>`
- Produces: `LocalProfileAssetMissingError.role: PhotoRole` when metadata points to a missing blob.
- Produces: `deleteAsset(role: PhotoRole): Promise<ProfileMetadata | null>`
- Produces: `saveAttributes(attributes: ProfileAttributes): Promise<ProfileMetadata>`
- Produces: `deleteProfile(): Promise<void>`
- Produces: `loadLegacyImage(): Promise<string | null>`, `assignLegacyImage(role: PhotoRole): Promise<ProfileMetadata>`, and `deleteLegacyImage(): Promise<void>`.

- [ ] **Step 1: Install a test-only IndexedDB emulator**

Run:

```powershell
npm.cmd --prefix extension install --save-dev fake-indexeddb@^6.2.4
```

This dependency is test-only. Runtime code continues to use native IndexedDB.

- [ ] **Step 2: Write failing image validation tests**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prepareProfileImage } from "./image";

beforeEach(() => {
  vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue({ width: 800, height: 800, close: vi.fn() }));
});

describe("prepareProfileImage", () => {
  it("rejects unsupported image types", async () => {
    await expect(prepareProfileImage(new File(["x"], "photo.gif", { type: "image/gif" }), "face_front"))
      .rejects.toThrow("Use a JPEG, PNG, or WebP image.");
  });

  it("rejects a face image below its minimum dimensions", async () => {
    vi.mocked(createImageBitmap).mockResolvedValueOnce({ width: 600, height: 700, close: vi.fn() } as never);
    await expect(prepareProfileImage(new File(["x"], "face.jpg", { type: "image/jpeg" }), "face_front"))
      .rejects.toThrow("at least 720 by 720 pixels");
  });

  it("returns metadata for a valid image without retaining its file name", async () => {
    const result = await prepareProfileImage(new File(["x"], "private-name.jpg", { type: "image/jpeg" }), "face_front");
    expect(result.metadata).toMatchObject({ role: "face_front", width: 800, height: 800, mime_type: "image/jpeg" });
    expect(JSON.stringify(result.metadata)).not.toContain("private-name");
  });
});
```

- [ ] **Step 3: Run the image test and verify RED**

Run:

```powershell
extension\node_modules\.bin\vitest.cmd run src/profile/image.test.ts
```

Expected: FAIL because `image.ts` does not exist.

- [ ] **Step 4: Implement validation and native Canvas normalization**

Create `extension/src/profile/image.ts` with:

```ts
import type { PhotoRole, PreparedProfileImage } from "./types";

const accepted = new Set(["image/jpeg", "image/png", "image/webp"]);
const maxSourceBytes = 10 * 1024 * 1024;
const targetBytes = 2 * 1024 * 1024;
const minimum: Record<PhotoRole, readonly [number, number]> = {
  face_front: [720, 720], face_left: [720, 720], face_right: [720, 720],
  upper_body_front: [720, 960], upper_body_side: [720, 960],
  full_body_front: [720, 1280], full_body_side: [720, 1280],
  left_hand_wrist: [720, 720], right_hand_wrist: [720, 720],
  feet_front: [720, 720], feet_side_top: [720, 720],
};

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(
    (blob) => blob ? resolve(blob) : reject(new Error("We could not process that image.")),
    type === "image/png" ? "image/jpeg" : type,
    quality,
  ));
}

export async function prepareProfileImage(file: File, role: PhotoRole): Promise<PreparedProfileImage> {
  if (!accepted.has(file.type)) throw new Error("Use a JPEG, PNG, or WebP image.");
  if (file.size > maxSourceBytes) throw new Error("Choose an image smaller than 10 MB.");
  const bitmap = await createImageBitmap(file);
  const [minWidth, minHeight] = minimum[role];
  if (bitmap.width < minWidth || bitmap.height < minHeight) {
    bitmap.close();
    throw new Error(`Choose an image at least ${minWidth} by ${minHeight} pixels.`);
  }
  let blob: Blob = file;
  let width = bitmap.width;
  let height = bitmap.height;
  if (Math.max(width, height) > 2048 || file.size > targetBytes) {
    const scale = Math.min(1, 2048 / Math.max(width, height));
    width = Math.round(width * scale);
    height = Math.round(height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      bitmap.close();
      throw new Error("We could not process that image.");
    }
    context.drawImage(bitmap, 0, 0, width, height);
    for (const quality of [0.88, 0.75, 0.62]) {
      blob = await canvasBlob(canvas, file.type, quality);
      if (blob.size <= targetBytes) break;
    }
  }
  bitmap.close();
  return {
    blob,
    metadata: {
      role,
      mime_type: blob.type as PreparedProfileImage["metadata"]["mime_type"],
      width,
      height,
      byte_size: blob.size,
      updated_at: new Date().toISOString(),
    },
  };
}
```

Add an oversized-image test that stubs `HTMLCanvasElement.prototype.getContext` and `toBlob`, then asserts the returned edge is at most 2048 and the returned blob replaces the source.

- [ ] **Step 5: Write failing IndexedDB storage tests**

```ts
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { assignLegacyImage, deleteProfile, loadLegacyImage, loadProfile, loadRequiredAssets, saveAsset } from "./store";

beforeEach(async () => {
  let values: Record<string, unknown> = {};
  globalThis.chrome = {
    storage: { local: {
      get: vi.fn(async (key: string) => ({ [key]: values[key] })),
      set: vi.fn(async (next: Record<string, unknown>) => { values = { ...values, ...next }; }),
      remove: vi.fn(async (key: string) => { delete values[key]; }),
    } },
  } as unknown as typeof chrome;
  vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue({ width: 800, height: 800, close: vi.fn() }));
  await deleteProfile();
});

describe("profile store", () => {
  it("stores a blob in IndexedDB and metadata in Chrome storage", async () => {
    await saveAsset({
      blob: new Blob(["photo"], { type: "image/jpeg" }),
      metadata: { role: "face_front", mime_type: "image/jpeg", width: 800, height: 800, byte_size: 5, updated_at: "2026-08-15T00:00:00.000Z" },
    });
    expect((await loadProfile())?.assets.face_front?.width).toBe(800);
    expect((await loadRequiredAssets(["face_front"]))[0]).toMatchObject({ kind: "face_front" });
  });

  it("does not remove a legacy image until assignment succeeds", async () => {
    vi.mocked(chrome.storage.local.get).mockResolvedValue({ yourdrobe_profile_image: "data:image/jpeg;base64,cGhvdG8=" });
    expect(await loadLegacyImage()).toContain("data:image/jpeg");
    await assignLegacyImage("upper_body_front");
    expect(chrome.storage.local.remove).toHaveBeenCalledWith("yourdrobe_profile_image");
  });

  it("repairs metadata that points to a missing blob", async () => {
    await chrome.storage.local.set({ yourdrobe_profile_v2: {
      version: 2, consented_at: "2026-08-15T00:00:00.000Z", attributes: {},
      assets: { face_front: { role: "face_front", mime_type: "image/jpeg", width: 800, height: 800, byte_size: 5, updated_at: "2026-08-15T00:00:00.000Z" } },
    } });
    await expect(loadRequiredAssets(["face_front"])).rejects.toMatchObject({ role: "face_front" });
    expect((await loadProfile())?.assets.face_front).toBeUndefined();
  });
});
```

- [ ] **Step 6: Run the storage test and verify RED**

Run:

```powershell
extension\node_modules\.bin\vitest.cmd run src/profile/store.test.ts
```

Expected: FAIL because `store.ts` does not exist.

- [ ] **Step 7: Implement the minimal profile store**

Use one database, one `assets` object store keyed by `role`, and one metadata key:

```ts
const databaseName = "yourdrobe_profile";
const objectStoreName = "assets";
const metadataKey = "yourdrobe_profile_v2";
const legacyKey = "yourdrobe_profile_image";
```

Implement a private `transaction(mode, action)` helper around native IndexedDB. `saveAsset` must commit the blob first and write metadata second. If the metadata write fails, restore the previous blob. `deleteProfile` clears the object store and removes `metadataKey`; it removes `legacyKey` only when the user explicitly deletes the complete profile. `loadRequiredAssets` converts each blob with `FileReader.readAsDataURL` immediately before returning `{ kind, image_data_url }`.

Export `LocalProfileAssetMissingError`. If metadata names a role whose blob is absent, `loadRequiredAssets` removes only that stale metadata entry and throws the error with its `role`. `deleteAsset` removes one blob and its metadata entry. `saveAttributes` merges defined values and removes keys passed as `undefined` without modifying any blob.

Implement `assignLegacyImage` by converting the existing data URL to a Blob, passing it through `prepareProfileImage`, storing the new role, and calling `chrome.storage.local.remove(legacyKey)` only after `saveAsset` resolves.

Implement `deleteLegacyImage` as the single explicit `chrome.storage.local.remove(legacyKey)` path used by the manager after confirmation.

- [ ] **Step 8: Run profile tests and full extension tests**

Run:

```powershell
extension\node_modules\.bin\vitest.cmd run src/profile/image.test.ts src/profile/store.test.ts
npm.cmd --prefix extension test
```

Expected: all tests PASS.

- [ ] **Step 9: Commit the browser-local profile foundation**

```powershell
git add extension/package.json extension/package-lock.json extension/src/profile/image.ts extension/src/profile/image.test.ts extension/src/profile/store.ts extension/src/profile/store.test.ts
git commit -m "feat: store profile photos locally"
```

---

### Task 3: Multi-asset backend profile contract

**Files:**
- Modify: `backend/app/main.py`
- Modify: `backend/tests/test_api.py`

**Interfaces:**
- Consumes: profile asset roles and fine-grained product types defined in Task 1.
- Produces: `POST /v1/profiles` accepting `assets[]` and `attributes`.
- Produces: bounded `profiles: dict[str, set[str]]` containing only role names.
- Produces: HTTP 422 detail `{ "code": "missing_profile_assets", "roles": [...] }` from `POST /v1/tryons/batch`.

- [ ] **Step 1: Add a backend test helper and failing multi-asset tests**

Add this helper to `ApiJourneyTest`:

```python
def create_profile(self, session_id: str, roles: tuple[str, ...] = ("upper_body_front",)) -> str:
    response = self.client.post("/v1/profiles", json={
        "session_id": session_id,
        "consent": True,
        "assets": [
            {"kind": role, "image_data_url": "data:image/jpeg;base64,ZmFrZQ=="}
            for role in roles
        ],
        "attributes": {"height_cm": 170, "top_size": "M"},
    })
    self.assertEqual(response.status_code, 200)
    return response.json()["profile_id"]
```

Add tests:

```python
def test_profile_retains_only_asset_roles(self) -> None:
    session_id = self.client.post("/v1/sessions", json={}).json()["session_id"]
    profile_id = self.create_profile(session_id, ("face_front", "right_hand_wrist"))
    self.assertEqual(profiles[profile_id], {"face_front", "right_hand_wrist"})
    self.assertNotIn("ZmFrZQ", repr(profiles))
    self.assertNotIn("height_cm", repr(profiles))

def test_profile_rejects_duplicate_or_unsupported_roles(self) -> None:
    session_id = self.client.post("/v1/sessions", json={}).json()["session_id"]
    duplicate = self.client.post("/v1/profiles", json={
        "session_id": session_id, "consent": True,
        "assets": [
            {"kind": "face_front", "image_data_url": "data:image/jpeg;base64,QQ=="},
            {"kind": "face_front", "image_data_url": "data:image/jpeg;base64,Qg=="},
        ],
        "attributes": {},
    })
    unsupported = self.client.post("/v1/profiles", json={
        "session_id": session_id, "consent": True,
        "assets": [{"kind": "passport", "image_data_url": "data:image/jpeg;base64,QQ=="}],
        "attributes": {},
    })
    self.assertEqual(duplicate.status_code, 400)
    self.assertEqual(unsupported.status_code, 422)
```

- [ ] **Step 2: Run the new tests and verify RED**

Run:

```powershell
$env:PYTHONPATH='backend'
backend\.venv\Scripts\python.exe -m unittest backend.tests.test_api.ApiJourneyTest.test_profile_retains_only_asset_roles backend.tests.test_api.ApiJourneyTest.test_profile_rejects_duplicate_or_unsupported_roles -v
```

Expected: FAIL because the endpoint still expects `image_data_url`.

- [ ] **Step 3: Define the exact backend models and role requirements**

Add `Literal` imports and models:

```python
PhotoRole = Literal[
    "face_front", "face_left", "face_right", "upper_body_front", "upper_body_side",
    "full_body_front", "full_body_side", "left_hand_wrist", "right_hand_wrist",
    "feet_front", "feet_side_top",
]

class ProfileAssetInput(BaseModel):
    kind: PhotoRole
    image_data_url: str

class ProfileAttributesInput(BaseModel):
    height_cm: float | None = None
    top_size: str | None = None
    bottom_size: str | None = None
    dress_size: str | None = None
    chest_cm: float | None = None
    waist_cm: float | None = None
    hips_cm: float | None = None
    inseam_cm: float | None = None
    skin_tone: str | None = None
    undertone: str | None = None
    shoe_size_system: str | None = None
    shoe_size: str | None = None
    ring_size: str | None = None
    left_wrist_cm: float | None = None
    right_wrist_cm: float | None = None

class ProfileInput(BaseModel):
    session_id: str
    assets: list[ProfileAssetInput] = Field(min_length=1, max_length=11)
    attributes: ProfileAttributesInput = Field(default_factory=ProfileAttributesInput)
    consent: bool
```

Add `product_type` to `ProductInput` using the exact string literals from Task 1 plus `unknown`, with `"unknown"` as the default so existing normalization clients remain valid during the staged rollout.

Add requirement alternatives:

```python
PRODUCT_REQUIREMENTS = {
    "makeup": (("face_front",),),
    "eyewear": (("face_front",),),
    "headwear": (("face_front",),),
    "earrings": (("face_front",),),
    "necklace": (("upper_body_front",),),
    "top": (("upper_body_front",),),
    "outerwear": (("upper_body_front",),),
    "dress": (("full_body_front",),),
    "bottom": (("full_body_front",),),
    "belt": (("full_body_front",),),
    "bag": (("full_body_front",),),
    "watch": (("left_hand_wrist", "right_hand_wrist"),),
    "bracelet": (("left_hand_wrist", "right_hand_wrist"),),
    "ring": (("left_hand_wrist", "right_hand_wrist"),),
    "footwear": (("feet_front",),),
}
```

- [ ] **Step 4: Store only role sets in the profile endpoint**

Replace the single-image check with:

```python
roles = [asset.kind for asset in body.assets]
if len(set(roles)) != len(roles):
    raise HTTPException(400, "Profile asset roles must be unique")
if any(not asset.image_data_url.startswith("data:image/") for asset in body.assets):
    raise HTTPException(400, "Every profile asset must be a valid image")
profile_id = new_id("profile")
remember(profiles, profile_id, set(roles))
return {"profile_id": profile_id, "status": "ready", "roles": roles}
```

Update existing backend tests to use `self.create_profile(...)` instead of the legacy payload.

- [ ] **Step 5: Add a failing missing-requirement job test**

```python
def test_tryon_reports_missing_profile_roles(self) -> None:
    session_id = self.client.post("/v1/sessions", json={}).json()["session_id"]
    profile_id = self.create_profile(session_id, ("face_front",))
    product_id = self.client.post("/v1/products/normalize", json={
        "platform": "amazon_in",
        "products": [{
            "platform": "amazon_in", "title": "Linen Dress", "category": "apparel",
            "product_type": "dress", "image_url": "https://images.example/dress.jpg",
            "product_url": "https://amazon.in/dp/DRESS",
        }],
    }).json()["products"][0]["id"]
    response = self.client.post("/v1/tryons/batch", json={
        "session_id": session_id, "profile_id": profile_id, "product_ids": [product_id],
    })
    self.assertEqual(response.status_code, 422)
    self.assertEqual(response.json()["detail"], {
        "code": "missing_profile_assets", "roles": ["full_body_front"],
    })
```

- [ ] **Step 6: Run the missing-role test and verify RED**

Run:

```powershell
$env:PYTHONPATH='backend'
backend\.venv\Scripts\python.exe -m unittest backend.tests.test_api.ApiJourneyTest.test_tryon_reports_missing_profile_roles -v
```

Expected: FAIL because batch creation does not validate role requirements.

- [ ] **Step 7: Validate requirements before creating any jobs**

Resolve all product IDs first, then collect missing requirement keys. Return `hand_wrist` when neither alternative hand role exists; return the concrete role name for other requirements. Sort missing names before placing them in the HTTP 422 detail. Perform this validation before the job-creation loop so a failing batch creates zero jobs.

- [ ] **Step 8: Run the backend suite**

Run:

```powershell
$env:PYTHONPATH='backend'
backend\.venv\Scripts\python.exe -m unittest backend.tests.test_api -v
```

Expected: all tests PASS, including existing bounded-memory and mock completion tests.

- [ ] **Step 9: Commit the backend contract**

```powershell
git add backend/app/main.py backend/tests/test_api.py
git commit -m "feat: validate multi-photo profiles"
```

---

### Task 4: Progressive file-upload component

**Files:**
- Create: `extension/src/sidepanel/ProfileSetup.tsx`
- Create: `extension/src/sidepanel/ProfileSetup.test.tsx`
- Modify: `extension/src/sidepanel/styles.css`

**Interfaces:**
- Consumes: `ProductType`, `RequirementKey`, `PhotoRole`, `ProfileAttributes`, `prepareProfileImage`, `rolesForRequirement`, `saveAsset`, and `saveAttributes`.
- Produces: `ProfileSetup({ requirements, productTypes, onSaved, onCancel })`.

- [ ] **Step 1: Write a failing progressive-upload component test**

Mock `prepareProfileImage`, `saveAsset`, and `saveAttributes`, then render:

```tsx
<ProfileSetup
  requirements={["face_front", "hand_wrist"]}
  productTypes={["makeup", "watch"]}
  onSaved={onSaved}
  onCancel={vi.fn()}
/>
```

Assert that:

```ts
expect(host.textContent).toContain("Front face photo");
expect(host.textContent).toContain("Hand and wrist photo");
expect(host.querySelectorAll('input[type="file"]')).toHaveLength(2);
```

Choose `right_hand_wrist`, attach both files, leave consent unchecked, click **Save profile photos**, and assert the storage mocks were not called and the alert says `Agree to local profile storage before saving.`. Then check consent, click again, and assert both prepared assets are saved and `onSaved` is called once.

- [ ] **Step 2: Run the component test and verify RED**

Run:

```powershell
extension\node_modules\.bin\vitest.cmd run src/sidepanel/ProfileSetup.test.tsx
```

Expected: FAIL because `ProfileSetup.tsx` does not exist.

- [ ] **Step 3: Implement the focused setup component**

Use a fixed label and guidance map:

```ts
const guidance: Record<RequirementKey, { label: string; help: string }> = {
  face_front: { label: "Front face photo", help: "Use an evenly lit, unobstructed front-facing photo." },
  upper_body_front: { label: "Front upper-body photo", help: "Include your head, shoulders, torso, and waist." },
  full_body_front: { label: "Front full-body photo", help: "Include your full body from head to feet." },
  hand_wrist: { label: "Hand and wrist photo", help: "Show one hand and wrist clearly; choose which side it is." },
  feet_front: { label: "Standing feet photo", help: "Show both feet clearly while standing." },
};
```

For `hand_wrist`, render a required native `<select>` containing `left_hand_wrist` and `right_hand_wrist`. For all other requirements, use the first result from `rolesForRequirement`. Maintain local maps for chosen files and errors. On submit, require consent and one file per requirement, call `prepareProfileImage` for each role, save each valid asset, save only the optional attributes shown for the current requirements, and call `onSaved` after every write succeeds.

Derive optional fields from `productTypes` with this exact mapping:

```ts
const clothingTypes = new Set(["top", "outerwear", "dress", "bottom", "belt", "bag"]);
const jewelleryTypes = new Set(["watch", "bracelet", "ring"]);

const showClothing = productTypes.some((type) => clothingTypes.has(type));
const showMakeup = productTypes.includes("makeup");
const showFootwear = productTypes.includes("footwear");
const showJewellery = productTypes.some((type) => jewelleryTypes.has(type));
```

Always offer `height_cm`. When `showClothing`, offer top, bottom, and dress size plus chest, waist, hips, and inseam. When `showMakeup`, offer user-selected skin tone and undertone. When `showFootwear`, offer shoe-size system and shoe size. When `showJewellery`, offer ring size and left/right wrist circumference. Empty fields must be omitted from `ProfileAttributes`.

If one file fails validation, show its error beside that input and do not write any prepared asset from that submit attempt.

- [ ] **Step 4: Add accessible styling using existing tokens**

Add only layout rules for `.profile-fields`, `.profile-field`, `.profile-guidance`, `.profile-actions`, and `.profile-progress`. Reuse existing button, input, error, focus, light, and dark styles. Do not add a dependency, gradient, nested card, or animation.

- [ ] **Step 5: Run the component and full extension tests**

Run:

```powershell
extension\node_modules\.bin\vitest.cmd run src/sidepanel/ProfileSetup.test.tsx
npm.cmd --prefix extension test
```

Expected: all tests PASS.

- [ ] **Step 6: Commit the progressive upload component**

```powershell
git add extension/src/sidepanel/ProfileSetup.tsx extension/src/sidepanel/ProfileSetup.test.tsx extension/src/sidepanel/styles.css
git commit -m "feat: add progressive profile uploads"
```

---

### Task 5: Side-panel and API integration

**Files:**
- Modify: `extension/src/sidepanel/App.tsx`
- Modify: `extension/src/sidepanel/App.test.tsx`
- Modify: `extension/src/sidepanel/api.ts`
- Modify: `extension/src/types.ts`

**Interfaces:**
- Consumes: Tasks 1 through 4.
- Produces: a `profile-setup` phase that appears only for missing requirements.
- Produces: `startDemo(assets: ProfileAssetUpload[], attributes: ProfileAttributes, products: Product[], signal?: AbortSignal)`.
- Produces: `MissingProfileAssetsError.roles: RequirementKey[]` for HTTP 422 responses.

- [ ] **Step 1: Replace single-photo App test setup with profile mocks**

Mock the store module at file scope:

```ts
vi.mock("../profile/store", () => ({
  loadProfile: vi.fn(),
  loadRequiredAssets: vi.fn(),
  loadLegacyImage: vi.fn().mockResolvedValue(null),
}));
```

Add a failing test where `loadProfile` resolves to `null`, the extracted product has `product_type: "dress"`, and clicking **Try these products** must render `Front full-body photo` rather than call `fetch`.

Add a second failing test where metadata contains `full_body_front`, `loadRequiredAssets` returns one data URL, and the complete mock API journey reaches `Your previews`.

Add a third failing test with `product_type: "unknown"`. Assert the ready state renders `Choose product type for Daily essential`, selecting `dress` updates that product in local state, and clicking **Try these products** opens the full-body setup. This prevents the profile flow from silently guessing a capture requirement.

- [ ] **Step 2: Run App tests and verify RED**

Run:

```powershell
extension\node_modules\.bin\vitest.cmd run src/sidepanel/App.test.tsx
```

Expected: FAIL because App still reads `yourdrobe_profile_image` and has no progressive phase.

- [ ] **Step 3: Change the API profile payload**

Change `startDemo` to create the profile with:

```ts
body: JSON.stringify({
  session_id: session.session_id,
  assets,
  attributes,
  consent: true,
}),
```

Continue normalizing the same products and creating the same mock batch.

Add:

```ts
export class MissingProfileAssetsError extends Error {
  constructor(readonly roles: RequirementKey[]) {
    super("Additional profile photos are required.");
  }
}
```

When a 422 body has `detail.code === "missing_profile_assets"` and a string array `detail.roles`, throw this error. Keep all other backend messages generic and user-safe.

- [ ] **Step 4: Integrate progressive profile state into App**

Replace `profileImage` with `profile: ProfileMetadata | null`. Add `profile-setup` to `Phase` and `missing: RequirementKey[]` state.

On load, call `loadProfile()` alongside product extraction. The ready state no longer depends on having one generic image.

For every product whose type is missing or `unknown`, render a required native product-type select immediately below its product row. Use this exact option list:

```ts
const selectableProductTypes: ProductType[] = [
  "makeup", "eyewear", "headwear", "earrings", "necklace", "top", "outerwear",
  "dress", "bottom", "belt", "bag", "watch", "bracelet", "ring", "footwear",
];
```

The visible label is `Choose product type for ${product.title}`. Update only that product in local `products` state. Disable **Try these products** while any displayed product remains `unknown`.

On **Try these products**:

```ts
const required = missingRequirements(products.slice(0, 5), Object.keys(profile?.assets ?? {}) as PhotoRole[]);
if (required.length) {
  setMissing(required);
  setPhase("profile-setup");
  return;
}
```

When requirements are satisfied, compute concrete roles with `requirementsForProducts` and `rolesForRequirement`, choosing the available alternative for `hand_wrist`. Call `loadRequiredAssets`, then `startDemo(assets, profile?.attributes ?? {}, products.slice(0, 5), signal)`.

Render `ProfileSetup` in the new phase. Its `onSaved` callback reloads metadata and returns to `ready`; the user clicks **Try these products** again to make the network request.

Pass `productTypes={products.map((product) => product.product_type ?? "unknown")}` to `ProfileSetup`.

Catch `MissingProfileAssetsError`, set its roles as missing, and reopen `profile-setup`. Preserve the existing timeout, cancellation, empty, and generic backend error behavior.

Catch `LocalProfileAssetMissingError` separately: reload the repaired metadata, recompute `missingRequirements`, and open `profile-setup` instead of showing a backend error.

- [ ] **Step 5: Run App, API, and full extension tests**

Run:

```powershell
extension\node_modules\.bin\vitest.cmd run src/sidepanel/App.test.tsx src/sidepanel/ProfileSetup.test.tsx
npm.cmd --prefix extension test
npm.cmd --prefix extension run build
```

Expected: tests PASS and the production build succeeds.

- [ ] **Step 6: Commit the end-to-end progressive flow**

```powershell
git add extension/src/sidepanel/App.tsx extension/src/sidepanel/App.test.tsx extension/src/sidepanel/api.ts extension/src/types.ts
git commit -m "feat: require profile photos by product"
```

---

### Task 6: Profile management and legacy migration UI

**Files:**
- Create: `extension/src/sidepanel/ProfileManager.tsx`
- Create: `extension/src/sidepanel/ProfileManager.test.tsx`
- Modify: `extension/src/sidepanel/App.tsx`
- Modify: `extension/src/sidepanel/App.test.tsx`
- Modify: `extension/src/sidepanel/styles.css`
- Modify: `extension/src/profile/store.ts`
- Modify: `extension/src/profile/store.test.ts`

**Interfaces:**
- Consumes: profile store and image helpers from Task 2.
- Produces: `ProfileManager({ profile, legacyImage, onChanged, onClose })`.
- Produces: explicit replace, per-role delete, full delete, attribute editing, and legacy role assignment.

- [ ] **Step 1: Write failing manager tests**

Render the manager with one `face_front` asset and a legacy image. Assert:

- the UI displays `Front face photo` and `Unclassified existing photo`;
- category completion shows face products complete and footwear missing;
- assigning the legacy image to `upper_body_front` calls `assignLegacyImage("upper_body_front")`;
- deleting `face_front` calls `deleteAsset("face_front")` after confirmation;
- cancelling the confirmation does not call `deleteProfile`;
- confirming **Delete complete profile** calls `deleteProfile()` and `onChanged()`;
- saving optional fields calls `saveAttributes` with numeric centimetre values converted from input strings.

- [ ] **Step 2: Run the manager test and verify RED**

Run:

```powershell
extension\node_modules\.bin\vitest.cmd run src/sidepanel/ProfileManager.test.tsx
```

Expected: FAIL because `ProfileManager.tsx` does not exist.

- [ ] **Step 3: Implement profile management**

Render one row per existing asset with its role label, update date, a replacement file input, and **Delete photo**. Replacement uses `prepareProfileImage` and `saveAsset`; it leaves the old asset intact if validation or storage fails.

Above the asset rows, show five compact completion lines computed with `rolesForRequirement`: **Makeup and face accessories**, **Upper-body clothing**, **Full-body clothing**, **Hand and wrist accessories**, and **Footwear**. Each line displays `Complete` or `Photo needed`; completion is derived from stored roles and is not persisted separately.

When `legacyImage` exists, show a preview, a native role `<select>` with all eleven photo roles, **Assign photo**, and **Delete old photo**. Assignment calls `assignLegacyImage`. After confirmation, deletion calls `deleteLegacyImage()` so the manager never writes the legacy storage key directly.

Render optional attributes in category groups. Use `type="number"`, positive minimums, and sensible steps for centimetre values. Empty inputs remove their keys. Saving merges the submitted attributes through `saveAttributes`.

Use `globalThis.confirm("Delete your complete local Yourdrobe profile?")` for full deletion. This is the only full-profile destructive action.

- [ ] **Step 4: Add manager routing to App**

Add `profile-manager` to `Phase`, load `loadLegacyImage()` on startup, and render a secondary **Manage profile** action in ready and results states. After any manager change, reload metadata and legacy state. Closing the manager returns to `ready` when products exist or `empty` otherwise.

Remove the old single-photo setup UI and its direct `FileReader` helper from `App.tsx`; Task 4 and the manager now own uploads.

- [ ] **Step 5: Verify legacy data-loss protection**

Extend `store.test.ts` so a forced `saveAsset` failure leaves `yourdrobe_profile_image` untouched. Assert successful assignment removes it exactly once.

- [ ] **Step 6: Run manager, App, and full extension tests**

Run:

```powershell
extension\node_modules\.bin\vitest.cmd run src/sidepanel/ProfileManager.test.tsx src/sidepanel/App.test.tsx src/profile/store.test.ts
npm.cmd --prefix extension test
npm.cmd --prefix extension run build
```

Expected: all tests PASS and build succeeds.

- [ ] **Step 7: Commit profile management**

```powershell
git add extension/src/sidepanel/ProfileManager.tsx extension/src/sidepanel/ProfileManager.test.tsx extension/src/sidepanel/App.tsx extension/src/sidepanel/App.test.tsx extension/src/sidepanel/styles.css extension/src/profile/store.ts extension/src/profile/store.test.ts
git commit -m "feat: manage local user profiles"
```

---

### Task 7: Documentation, complete verification, and push

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: completed profile flow from Tasks 1 through 6.
- Produces: exact setup, privacy, migration, deletion, mock-boundary, and verification instructions.

- [ ] **Step 1: Update README behavior and privacy documentation**

Document these exact facts:

- Clicking **Try these products** requests only missing category-specific photos.
- Users upload files in this phase; guided camera capture is deferred.
- Photos are stored as IndexedDB blobs in Chrome and metadata is stored in `chrome.storage.local`.
- Only required images are sent to the local backend on port 8001, and the backend does not retain them.
- **Manage profile** replaces or deletes individual photos and can delete the complete profile.
- Existing single-photo profiles must be assigned a role once.
- Attributes are optional and locally stored.
- Previews remain mocks that reuse product imagery.
- YouCam, cloud profiles, and 3D are not present.

- [ ] **Step 2: Run all automated verification from the worktree root**

```powershell
$env:PYTHONPATH='backend'
backend\.venv\Scripts\python.exe -m unittest backend.tests.test_api -v
npm.cmd --prefix extension test
npm.cmd --prefix extension run build
git diff --check
git status --short --branch
```

Expected: backend tests PASS, extension tests PASS, build succeeds, `git diff --check` prints nothing, and only `README.md` is uncommitted.

- [ ] **Step 3: Commit documentation as its own micro commit**

```powershell
git add README.md
git commit -m "docs: explain progressive user profiles"
```

- [ ] **Step 4: Inspect the complete micro-commit sequence**

```powershell
git log --reverse --format="%h %s" origin/feature/hackathon-slice..HEAD
git status --short --branch
```

Expected: the design, plan, taxonomy, storage, backend, upload UI, integration, manager, and README each appear as narrow commits; the worktree is clean.

- [ ] **Step 5: Push the verified branch**

```powershell
git push origin feature/hackathon-slice
```

Expected: the remote branch advances to the verified local HEAD and PR #1 updates.

- [ ] **Step 6: Begin the separate YouCam design sequence**

After the push succeeds, start a new brainstorming pass for the YouCam provider adapter. Confirm the exact YouCam product/API, authentication method, supported product categories, required image inputs, asynchronous job contract, quotas, and credentials before changing code. Do not reuse mock assumptions as provider facts.
