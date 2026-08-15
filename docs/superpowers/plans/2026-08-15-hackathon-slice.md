# Yourdrobe Multi-Site Hackathon Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a locally runnable Chrome extension that extracts products from Amazon India, Amazon US, Flipkart, and Nykaa, then completes a clearly labeled mocked virtual try-on flow through FastAPI.

**Architecture:** A Manifest V3 extension selects one hostname-specific DOM adapter and sends normalized products to a local FastAPI process. The backend keeps demo state in memory and exposes the approved asynchronous job API; the side panel stores one consented profile image in Chrome local storage, polls mock jobs, and links results back to their original listings.

**Tech Stack:** Node.js 24, npm, TypeScript, React, Vite, Vitest, JSDOM, Chrome Manifest V3, Python 3.14, FastAPI, unittest, and HTTPX.

## Global Constraints

- Supported hosts are exactly `amazon.in`, `amazon.com`, `flipkart.com`, and `nykaa.com`, including `www` subdomains.
- Extract at most five visible products from a search or category page.
- Amazon India and Amazon US share one adapter with host-aware `INR`/`USD` currency handling.
- All virtual try-on output is visibly labeled as a mock preview.
- Keep state local and disposable: Chrome local storage in the extension and process memory in FastAPI.
- Do not add GCP, Vertex AI, YouCam, PostgreSQL, Redis, Docker, makeup-specific AI, or any 3D files, routes, UI, dependencies, or skeletons.
- Never read, bundle, log, or commit `my-product-sa-key.json` or any other credential file.

---

## File Map

```text
.gitignore                                      secret/build exclusions
README.md                                       local setup and Chrome loading guide
backend/requirements.txt                        Python runtime/test dependencies
backend/app/__init__.py                         package marker
backend/app/main.py                             complete in-memory FastAPI slice
backend/tests/__init__.py                       test package marker
backend/tests/test_api.py                       API journey smoke test
extension/package.json                          npm scripts and dependencies
extension/tsconfig.json                         strict TypeScript configuration
extension/vite.config.ts                        side-panel/background/content entries
extension/sidepanel.html                        side-panel HTML entry
extension/public/manifest.json                  Manifest V3 configuration
extension/src/types.ts                          shared product/job message types
extension/src/content/adapters/types.ts         adapter interface
extension/src/content/adapters/shared.ts        bounded DOM extraction helpers
extension/src/content/adapters/amazon.ts        Amazon India/US selectors
extension/src/content/adapters/flipkart.ts      Flipkart selectors
extension/src/content/adapters/nykaa.ts         Nykaa selectors
extension/src/content/adapters/index.ts         hostname adapter selection
extension/src/content/adapters/adapters.test.ts four fixture-based adapter checks
extension/src/content/content-script.ts         message-to-adapter bridge
extension/src/background/service-worker.ts      side-panel action wiring
extension/src/sidepanel/api.ts                   local backend client
extension/src/sidepanel/App.tsx                 onboarding-to-results flow
extension/src/sidepanel/main.tsx                React bootstrap
extension/src/sidepanel/styles.css              compact side-panel styling
```

---

### Task 1: Secure Repository and FastAPI Vertical Slice

**Files:**
- Create: `.gitignore`
- Create: `backend/requirements.txt`
- Create: `backend/app/__init__.py`
- Create: `backend/app/main.py`
- Create: `backend/tests/__init__.py`
- Create: `backend/tests/test_api.py`

**Interfaces:**
- Consumes: normalized products shaped as `{platform, title, price?, currency?, category, image_url, product_url, metadata}`.
- Produces: `app`, `POST /v1/sessions`, `POST /v1/profiles`, `POST /v1/products/normalize`, `POST /v1/tryons/batch`, `GET /v1/tryons/{job_id}`, and `GET /health`.

- [ ] **Step 1: Add credential and build exclusions**

Create `.gitignore` with:

```gitignore
my-product-sa-key.json
*-service-account*.json
*-sa-key.json
.env
.env.*
!.env.example
node_modules/
dist/
__pycache__/
*.py[cod]
.venv/
```

Verify the existing key is ignored:

```powershell
git check-ignore -v my-product-sa-key.json
```

Expected: output names `.gitignore` and `my-product-sa-key.json`.

- [ ] **Step 2: Declare minimal Python dependencies**

Create `backend/requirements.txt`:

```text
fastapi>=0.116,<1
uvicorn>=0.35,<1
httpx>=0.28,<1
```

Create empty `backend/app/__init__.py` and `backend/tests/__init__.py`, then install:

```powershell
python -m venv backend/.venv
backend/.venv/Scripts/python.exe -m pip install -r backend/requirements.txt
```

- [ ] **Step 3: Write the failing API journey test**

Create `backend/tests/test_api.py`:

```python
import time
import unittest

from fastapi.testclient import TestClient

from app.main import app


class ApiJourneyTest(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app)

    def test_mock_tryon_journey(self) -> None:
        self.assertEqual(self.client.get("/health").json(), {"status": "ok"})

        session = self.client.post("/v1/sessions", json={}).json()
        profile_response = self.client.post(
            "/v1/profiles",
            json={
                "session_id": session["session_id"],
                "image_data_url": "data:image/jpeg;base64,ZmFrZQ==",
                "consent": True,
            },
        )
        self.assertEqual(profile_response.status_code, 200)
        profile = profile_response.json()

        normalized = self.client.post(
            "/v1/products/normalize",
            json={
                "platform": "amazon_in",
                "products": [{
                    "platform": "amazon_in",
                    "title": "Red Shirt",
                    "price": 1799,
                    "currency": "INR",
                    "category": "apparel",
                    "image_url": "https://images.example/shirt.jpg",
                    "product_url": "https://www.amazon.in/dp/B001",
                    "metadata": {"color": "red"},
                }],
            },
        ).json()

        jobs = self.client.post(
            "/v1/tryons/batch",
            json={
                "session_id": session["session_id"],
                "profile_id": profile["profile_id"],
                "product_ids": [normalized["products"][0]["id"]],
            },
        ).json()["jobs"]

        time.sleep(0.3)
        result = self.client.get(f"/v1/tryons/{jobs[0]['job_id']}").json()
        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["result_url"], "https://images.example/shirt.jpg")
        self.assertTrue(result["mock"])

    def test_profile_requires_consent(self) -> None:
        session = self.client.post("/v1/sessions", json={}).json()
        response = self.client.post(
            "/v1/profiles",
            json={
                "session_id": session["session_id"],
                "image_data_url": "data:image/jpeg;base64,ZmFrZQ==",
                "consent": False,
            },
        )
        self.assertEqual(response.status_code, 400)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 4: Run the test to verify it fails**

Run:

```powershell
$env:PYTHONPATH='backend'; backend/.venv/Scripts/python.exe -m unittest backend.tests.test_api -v
```

Expected: FAIL because `app.main` does not exist.

- [ ] **Step 5: Implement the minimal in-memory API**

Create `backend/app/main.py` with these exact public models and behaviors:

```python
from time import monotonic
from uuid import uuid4

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field


class ProfileInput(BaseModel):
    session_id: str
    image_data_url: str
    consent: bool


class ProductInput(BaseModel):
    platform: str
    title: str = Field(min_length=1)
    price: float | None = None
    currency: str | None = None
    category: str = "other"
    image_url: str
    product_url: str
    metadata: dict[str, str] = Field(default_factory=dict)


class NormalizeInput(BaseModel):
    platform: str
    products: list[ProductInput]


class BatchInput(BaseModel):
    session_id: str
    profile_id: str
    product_ids: list[str] = Field(min_length=1, max_length=5)


app = FastAPI(title="Yourdrobe Demo API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

sessions: set[str] = set()
profiles: set[str] = set()
products: dict[str, dict] = {}
jobs: dict[str, dict] = {}


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex}"


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/v1/sessions")
def create_session() -> dict[str, str]:
    session_id = new_id("sess")
    sessions.add(session_id)
    return {"session_id": session_id}


@app.post("/v1/profiles")
def create_profile(body: ProfileInput) -> dict[str, str]:
    if body.session_id not in sessions:
        raise HTTPException(404, "Session not found")
    if not body.consent:
        raise HTTPException(400, "Profile consent is required")
    if not body.image_data_url.startswith("data:image/"):
        raise HTTPException(400, "A valid image is required")
    profile_id = new_id("profile")
    profiles.add(profile_id)
    return {"profile_id": profile_id, "status": "ready"}


@app.post("/v1/products/normalize")
def normalize_products(body: NormalizeInput) -> dict[str, list[dict]]:
    normalized = []
    for product in body.products[:5]:
        product_id = new_id("product")
        value = {"id": product_id, **product.model_dump()}
        products[product_id] = value
        normalized.append(value)
    return {"products": normalized}


@app.post("/v1/tryons/batch")
def create_tryons(body: BatchInput) -> dict[str, list[dict]]:
    if body.session_id not in sessions or body.profile_id not in profiles:
        raise HTTPException(404, "Session or profile not found")
    created = []
    for product_id in body.product_ids:
        if product_id not in products:
            raise HTTPException(404, f"Product not found: {product_id}")
        job_id = new_id("tryon")
        jobs[job_id] = {
            "job_id": job_id,
            "product_id": product_id,
            "created_at": monotonic(),
        }
        created.append({"job_id": job_id, "product_id": product_id, "status": "queued"})
    return {"jobs": created}


@app.get("/v1/tryons/{job_id}")
def get_tryon(job_id: str) -> dict:
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Try-on job not found")
    if monotonic() - job["created_at"] < 0.25:
        return {"job_id": job_id, "status": "processing", "progress": 50}
    product = products[job["product_id"]]
    return {
        "job_id": job_id,
        "product_id": job["product_id"],
        "status": "completed",
        "result_url": product["image_url"],
        "mock": True,
    }
```

The image data URL is validated but intentionally not retained in backend state.

- [ ] **Step 6: Run the backend check**

Run:

```powershell
$env:PYTHONPATH='backend'; backend/.venv/Scripts/python.exe -m unittest backend.tests.test_api -v
```

Expected: 2 tests pass.

- [ ] **Step 7: Commit the backend slice**

```powershell
git add .gitignore backend
git commit -m "feat: add local mock try-on API"
```

---

### Task 2: Extension Scaffold and Multi-Site Adapters

**Files:**
- Create: `extension/package.json`
- Create: `extension/tsconfig.json`
- Create: `extension/vite.config.ts`
- Create: `extension/src/types.ts`
- Create: `extension/src/content/adapters/types.ts`
- Create: `extension/src/content/adapters/shared.ts`
- Create: `extension/src/content/adapters/amazon.ts`
- Create: `extension/src/content/adapters/flipkart.ts`
- Create: `extension/src/content/adapters/nykaa.ts`
- Create: `extension/src/content/adapters/index.ts`
- Create: `extension/src/content/adapters/adapters.test.ts`

**Interfaces:**
- Consumes: a `Document` and hostname.
- Produces: `selectAdapter(hostname: string, document: Document): CommerceAdapter | null` and `CommerceAdapter.extractProducts(): Product[]`.

- [ ] **Step 1: Create npm and TypeScript configuration**

Create `extension/package.json`:

```json
{
  "name": "yourdrobe-extension",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "build": "tsc --noEmit && vite build",
    "test": "vitest run"
  }
}
```

Install and lock the required packages:

```powershell
Set-Location extension
npm.cmd install react react-dom
npm.cmd install --save-dev typescript vite @vitejs/plugin-react vitest jsdom @types/react @types/react-dom @types/chrome
Set-Location ..
```

Create `extension/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "allowJs": false,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "strict": true,
    "forceConsistentCasingInFileNames": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "types": ["chrome", "vitest/globals"]
  },
  "include": ["src", "vite.config.ts"]
}
```

Create `extension/vite.config.ts`:

```typescript
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        sidepanel: resolve(import.meta.dirname, "sidepanel.html"),
        background: resolve(import.meta.dirname, "src/background/service-worker.ts"),
        content: resolve(import.meta.dirname, "src/content/content-script.ts"),
      },
      output: {
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
  test: { environment: "jsdom" },
});
```

- [ ] **Step 2: Define the normalized product and adapter contract**

Create `extension/src/types.ts`:

```typescript
export type Product = {
  id?: string;
  platform: "amazon_in" | "amazon_us" | "flipkart" | "nykaa";
  title: string;
  brand?: string;
  price?: number;
  currency?: "INR" | "USD";
  category: "apparel" | "makeup" | "other";
  image_url: string;
  product_url: string;
  metadata: { shade?: string; color?: string };
};

export type TryOnJob = {
  job_id: string;
  product_id: string;
  status: "queued" | "processing" | "completed" | "failed";
  result_url?: string;
  mock?: boolean;
};

export type ExtractProductsResponse =
  | { ok: true; products: Product[] }
  | { ok: false; error: string };
```

Create `extension/src/content/adapters/types.ts`:

```typescript
import type { Product } from "../../types";

export interface CommerceAdapter {
  extractProducts(): Product[];
}
```

- [ ] **Step 3: Write one failing fixture case for every supported website**

Create `extension/src/content/adapters/adapters.test.ts` using `document.body.innerHTML` fixtures for:

```typescript
import { afterEach, describe, expect, it } from "vitest";
import { selectAdapter } from ".";

afterEach(() => { document.body.innerHTML = ""; });

const cases = [
  {
    host: "www.amazon.in",
    html: `<div data-component-type="s-search-result" data-asin="IN1"><h2><a href="/dp/IN1"><span>Red Shirt</span></a></h2><img class="s-image" src="https://img/in.jpg"><span class="a-price-whole">1,799</span></div>`,
    platform: "amazon_in",
    currency: "INR",
    price: 1799,
    category: "apparel",
    url: "https://www.amazon.in/dp/IN1",
  },
  {
    host: "www.amazon.com",
    html: `<div data-component-type="s-search-result" data-asin="US1"><h2><a href="/dp/US1"><span>Blue Shirt</span></a></h2><img class="s-image" src="https://img/us.jpg"><span class="a-price-whole">29</span><span class="a-price-fraction">99</span></div>`,
    platform: "amazon_us",
    currency: "USD",
    price: 29.99,
    category: "apparel",
    url: "https://www.amazon.com/dp/US1",
  },
  {
    host: "www.flipkart.com",
    html: `<div data-id="FK1"><a href="/red-shirt/p/FK1"><img src="https://img/fk.jpg" alt="Red Shirt"><div class="product-title">Red Shirt</div><div class="price">₹1,499</div></a></div>`,
    platform: "flipkart",
    currency: "INR",
    price: 1499,
    category: "apparel",
    url: "https://www.flipkart.com/red-shirt/p/FK1",
  },
  {
    host: "www.nykaa.com",
    html: `<div data-testid="product-card"><a href="/red-lipstick/p/NY1"><img src="https://img/ny.jpg" alt="Ruby Red Lipstick"><div class="product-title">Ruby Red Lipstick</div><div class="price">₹799</div><span class="shade">Ruby Red</span></a></div>`,
    platform: "nykaa",
    currency: "INR",
    price: 799,
    category: "makeup",
    url: "https://www.nykaa.com/red-lipstick/p/NY1",
  },
] as const;

describe("commerce adapters", () => {
  for (const item of cases) {
    it(`extracts ${item.host}`, () => {
      document.body.innerHTML = item.html;
      const products = selectAdapter(item.host, document)?.extractProducts() ?? [];
      expect(products).toHaveLength(1);
      expect(products[0]).toMatchObject({
        platform: item.platform,
        currency: item.currency,
        price: item.price,
        category: item.category,
        product_url: item.url,
      });
      expect(products[0].title).toBeTruthy();
      expect(products[0].image_url).toMatch(/^https:/);
    });
  }
});
```

- [ ] **Step 4: Run adapter tests to verify they fail**

Run:

```powershell
npm.cmd --prefix extension test
```

Expected: FAIL because `selectAdapter` does not exist.

- [ ] **Step 5: Implement shared extraction and the three site modules**

Create `shared.ts` with:

```typescript
import type { Product } from "../../types";

export function text(root: Element, selectors: string[]): string {
  for (const selector of selectors) {
    const value = root.querySelector(selector)?.textContent?.trim();
    if (value) return value;
  }
  return "";
}

export function image(root: Element): string {
  const element = root.querySelector("img");
  return element?.getAttribute("src") || element?.getAttribute("data-src") || "";
}

export function absoluteUrl(hostname: string, href: string): string {
  return new URL(href, `https://${hostname}`).href;
}

export function price(value: string): number | undefined {
  const number = Number(value.replace(/[^0-9.]/g, ""));
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

export function valid(products: Product[]): Product[] {
  return products.filter((item) => item.title && item.image_url && item.product_url).slice(0, 5);
}
```

Create `amazon.ts`:

```typescript
import type { CommerceAdapter } from "./types";
import { absoluteUrl, image, price, text, valid } from "./shared";

export function amazonAdapter(hostname: string, document: Document): CommerceAdapter {
  const india = hostname.endsWith("amazon.in");
  return {
    extractProducts: () => valid(
      [...document.querySelectorAll("[data-component-type='s-search-result']")].map((card) => {
        const href = card.querySelector("h2 a")?.getAttribute("href") || "";
        const whole = text(card, [".a-price-whole"]);
        const fraction = text(card, [".a-price-fraction"]);
        return {
          platform: india ? "amazon_in" : "amazon_us",
          title: text(card, ["h2 span", "h2"]),
          price: price(fraction ? `${whole}.${fraction}` : whole),
          currency: india ? "INR" : "USD",
          category: "apparel",
          image_url: image(card),
          product_url: href ? absoluteUrl(hostname, href) : "",
          metadata: {},
        };
      }),
    ),
  };
}
```

Create `flipkart.ts`:

```typescript
import type { CommerceAdapter } from "./types";
import { absoluteUrl, image, price, text, valid } from "./shared";

const clothing = /shirt|dress|top|trouser|jean|jacket|kurta|saree|t-?shirt/i;

export function flipkartAdapter(hostname: string, document: Document): CommerceAdapter {
  return {
    extractProducts: () => valid([...document.querySelectorAll("[data-id]")].map((card) => {
      const title = text(card, [".product-title", "[class*='KzDlHZ']"])
        || card.querySelector("img")?.getAttribute("alt")?.trim() || "";
      const href = card.querySelector("a[href*='/p/']")?.getAttribute("href") || "";
      return {
        platform: "flipkart",
        title,
        price: price(text(card, [".price", "[class*='Nx9bqj']"])),
        currency: "INR",
        category: clothing.test(title) ? "apparel" : "other",
        image_url: image(card),
        product_url: href ? absoluteUrl(hostname, href) : "",
        metadata: {},
      };
    })),
  };
}
```

Create `nykaa.ts`:

```typescript
import type { CommerceAdapter } from "./types";
import { absoluteUrl, image, price, text, valid } from "./shared";

export function nykaaAdapter(hostname: string, document: Document): CommerceAdapter {
  return {
    extractProducts: () => valid([
      ...document.querySelectorAll("[data-testid='product-card'], .productWrapper"),
    ].map((card) => {
      const href = card.querySelector("a[href*='/p/']")?.getAttribute("href") || "";
      const shade = text(card, [".shade"]);
      return {
        platform: "nykaa",
        title: text(card, [".product-title", "[class*='css-xrzmfa']"])
          || card.querySelector("img")?.getAttribute("alt")?.trim() || "",
        price: price(text(card, [".price", "[class*='css-111z9ua']"])),
        currency: "INR",
        category: "makeup",
        image_url: image(card),
        product_url: href ? absoluteUrl(hostname, href) : "",
        metadata: shade ? { shade } : {},
      };
    })),
  };
}
```

Create `index.ts`:

```typescript
import { amazonAdapter } from "./amazon";
import { flipkartAdapter } from "./flipkart";
import { nykaaAdapter } from "./nykaa";
import type { CommerceAdapter } from "./types";

export function selectAdapter(hostname: string, document: Document): CommerceAdapter | null {
  const host = hostname.replace(/^www\./, "");
  if (host === "amazon.in" || host === "amazon.com") return amazonAdapter(hostname, document);
  if (host === "flipkart.com") return flipkartAdapter(hostname, document);
  if (host === "nykaa.com") return nykaaAdapter(hostname, document);
  return null;
}
```

- [ ] **Step 6: Run adapter tests**

```powershell
npm.cmd --prefix extension test
```

Expected: 4 tests pass.

- [ ] **Step 7: Commit adapter support**

```powershell
git add extension/package.json extension/package-lock.json extension/tsconfig.json extension/vite.config.ts extension/src/types.ts extension/src/content/adapters
git commit -m "feat: add multi-site product adapters"
```

---

### Task 3: Manifest V3 Browser Wiring

**Files:**
- Create: `extension/public/manifest.json`
- Create: `extension/src/content/content-script.ts`
- Create: `extension/src/background/service-worker.ts`

**Interfaces:**
- Consumes: `selectAdapter()` and Chrome runtime messages `{type: "EXTRACT_PRODUCTS"}`.
- Produces: `ExtractProductsResponse` to the side panel and an extension action that opens the side panel.

- [ ] **Step 1: Add the manifest**

Create `extension/public/manifest.json`:

```json
{
  "manifest_version": 3,
  "name": "Yourdrobe AI Try-On Demo",
  "version": "0.1.0",
  "description": "Extract products and preview the local Yourdrobe demo flow.",
  "permissions": ["activeTab", "sidePanel", "storage", "tabs"],
  "host_permissions": [
    "https://*.amazon.in/*",
    "https://*.amazon.com/*",
    "https://*.flipkart.com/*",
    "https://*.nykaa.com/*",
    "http://127.0.0.1:8000/*"
  ],
  "background": { "service_worker": "assets/background.js", "type": "module" },
  "action": { "default_title": "Open Yourdrobe" },
  "side_panel": { "default_path": "sidepanel.html" },
  "content_scripts": [{
    "matches": [
      "https://*.amazon.in/*",
      "https://*.amazon.com/*",
      "https://*.flipkart.com/*",
      "https://*.nykaa.com/*"
    ],
    "js": ["assets/content.js"],
    "run_at": "document_idle"
  }]
}
```

- [ ] **Step 2: Add the content-script message bridge**

Create `extension/src/content/content-script.ts`:

```typescript
import { selectAdapter } from "./adapters";
import type { ExtractProductsResponse } from "../types";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "EXTRACT_PRODUCTS") return false;
  const adapter = selectAdapter(location.hostname, document);
  const response: ExtractProductsResponse = adapter
    ? { ok: true, products: adapter.extractProducts() }
    : { ok: false, error: "This shopping site is not supported." };
  sendResponse(response);
  return false;
});
```

- [ ] **Step 3: Add the background action**

Create `extension/src/background/service-worker.ts`:

```typescript
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});
```

- [ ] **Step 4: Run static checks**

```powershell
npm.cmd --prefix extension exec tsc -- --noEmit
npm.cmd --prefix extension test
```

Expected: TypeScript succeeds and 4 adapter tests pass. Vite build is deferred until the side-panel HTML entry exists in Task 4.

- [ ] **Step 5: Commit browser wiring**

```powershell
git add extension/public extension/src/content/content-script.ts extension/src/background
git commit -m "feat: wire extension product extraction"
```

---

### Task 4: Side Panel Demo Journey

**Files:**
- Create: `extension/sidepanel.html`
- Create: `extension/src/sidepanel/api.ts`
- Create: `extension/src/sidepanel/App.tsx`
- Create: `extension/src/sidepanel/main.tsx`
- Create: `extension/src/sidepanel/styles.css`

**Interfaces:**
- Consumes: `ExtractProductsResponse`, backend endpoints from Task 1, and Chrome storage key `yourdrobe_profile_image`.
- Produces: onboarding, product list, mocked job progress, result list, retry, and original-listing navigation.

- [ ] **Step 1: Create the side-panel entry**

Create `extension/sidepanel.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Yourdrobe</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/sidepanel/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 2: Implement the narrow backend client**

Create `extension/src/sidepanel/api.ts` exporting:

```typescript
import type { Product, TryOnJob } from "../types";

const baseUrl = "http://127.0.0.1:8000/v1";
export type NormalizedProduct = Product & { id: string };

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) throw new Error((await response.json()).detail || "Backend request failed");
  return response.json() as Promise<T>;
}

export async function startDemo(imageDataUrl: string, products: Product[]) {
  const session = await json<{ session_id: string }>("/sessions", { method: "POST", body: "{}" });
  const profile = await json<{ profile_id: string }>("/profiles", {
    method: "POST",
    body: JSON.stringify({ session_id: session.session_id, image_data_url: imageDataUrl, consent: true }),
  });
  const normalized = await json<{ products: NormalizedProduct[] }>("/products/normalize", {
    method: "POST",
    body: JSON.stringify({ platform: products[0].platform, products }),
  });
  const batch = await json<{ jobs: TryOnJob[] }>("/tryons/batch", {
    method: "POST",
    body: JSON.stringify({
      session_id: session.session_id,
      profile_id: profile.profile_id,
      product_ids: normalized.products.map((product) => product.id),
    }),
  });
  return { products: normalized.products, jobs: batch.jobs };
}

export const getJob = (jobId: string) => json<TryOnJob>(`/tryons/${jobId}`);
```

- [ ] **Step 3: Implement the React state flow**

Create `App.tsx`:

```tsx
import { useEffect, useState } from "react";
import type { ExtractProductsResponse, Product, TryOnJob } from "../types";
import { getJob, startDemo, type NormalizedProduct } from "./api";

type Phase = "loading" | "needs-profile" | "ready" | "running" | "results" | "error";
type Result = { product: NormalizedProduct; job: TryOnJob };
const profileKey = "yourdrobe_profile_image";
const unsupported = "Open a supported Amazon, Flipkart, or Nykaa listing page and try again.";

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("We could not read that image."));
    reader.readAsDataURL(file);
  });
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function App() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [products, setProducts] = useState<Product[]>([]);
  const [profileImage, setProfileImage] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [consent, setConsent] = useState(false);
  const [results, setResults] = useState<Result[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    void Promise.all([
      chrome.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => {
        if (!tab?.id) throw new Error(unsupported);
        try {
          const response = await chrome.tabs.sendMessage<unknown, ExtractProductsResponse>(
            tab.id,
            { type: "EXTRACT_PRODUCTS" },
          );
          if (!response.ok) throw new Error(response.error);
          if (!response.products.length) throw new Error("No readable products were found on this page.");
          return response.products;
        } catch {
          throw new Error(unsupported);
        }
      }),
      chrome.storage.local.get(profileKey),
    ]).then(([foundProducts, stored]) => {
      const image = typeof stored[profileKey] === "string" ? stored[profileKey] : "";
      setProducts(foundProducts);
      setProfileImage(image);
      setPhase(image ? "ready" : "needs-profile");
    }).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : unsupported);
      setPhase("error");
    });
  }, []);

  async function saveProfile() {
    if (!file || !consent) {
      setError("Choose an image and agree to local demo storage.");
      return;
    }
    try {
      const image = await readFile(file);
      await chrome.storage.local.set({ [profileKey]: image });
      setProfileImage(image);
      setError("");
      setPhase("ready");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "We could not save that image.");
    }
  }

  async function runDemo() {
    setPhase("running");
    setError("");
    try {
      const started = await startDemo(profileImage, products.slice(0, 5));
      let current = started.jobs;
      while (current.some((job) => job.status === "queued" || job.status === "processing")) {
        await delay(300);
        current = await Promise.all(current.map((job) =>
          job.status === "completed" || job.status === "failed" ? job : getJob(job.job_id),
        ));
      }
      const byId = new Map(started.products.map((product) => [product.id, product]));
      setResults(current.flatMap((job) => {
        const product = byId.get(job.product_id);
        return product ? [{ product, job }] : [];
      }));
      setPhase("results");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The local backend is unavailable.");
      setPhase("error");
    }
  }

  return (
    <main>
      <header><span className="eyebrow">YOURDROBE</span><h1>Your fitting room, anywhere.</h1></header>

      {phase === "loading" && <p role="status">Reading products from this page…</p>}

      {phase === "needs-profile" && (
        <section>
          <h2>Create your local demo profile</h2>
          <p>Your image stays in this Chrome extension and is not sent to a live AI provider.</p>
          <label>Profile image<input type="file" accept="image/*" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label>
          <label className="check"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /> I agree to store this image locally for the demo.</label>
          {error && <p className="error" role="alert">{error}</p>}
          <button onClick={() => void saveProfile()}>Save profile</button>
        </section>
      )}

      {phase === "ready" && (
        <section>
          <h2>{products.length} products ready</h2>
          <div className="list">{products.map((product) => <ProductRow key={product.product_url} product={product} />)}</div>
          <button onClick={() => void runDemo()}>Try these products</button>
        </section>
      )}

      {phase === "running" && <p role="status">Creating your mock previews…</p>}

      {phase === "results" && (
        <section>
          <h2>Your previews</h2>
          <div className="list">{results.map(({ product, job }) => (
            <article className="product" key={job.job_id}>
              {job.status === "failed" ? <p className="error">This product preview failed; other results are still available.</p> : <>
                <div><span className="badge">Mock AI preview</span><h3>{product.title}</h3></div>
                <img src={job.result_url || product.image_url} alt={`Mock preview of ${product.title}`} />
              </>}
              <a className="button secondary" href={product.product_url} target="_blank" rel="noreferrer">View original product</a>
            </article>
          ))}</div>
        </section>
      )}

      {phase === "error" && <section><p className="error" role="alert">{error}</p><button onClick={() => location.reload()}>Retry</button></section>}
    </main>
  );
}

function ProductRow({ product }: { product: Product }) {
  const price = product.price && product.currency
    ? new Intl.NumberFormat(product.currency === "INR" ? "en-IN" : "en-US", { style: "currency", currency: product.currency }).format(product.price)
    : "Price unavailable";
  return <article className="product row"><img src={product.image_url} alt="" /><div><h3>{product.title}</h3><p>{price}</p><a href={product.product_url} target="_blank" rel="noreferrer">View listing</a></div></article>;
}
```

Create `main.tsx`:

```typescript
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode><App /></StrictMode>,
);
```

- [ ] **Step 4: Add compact accessible styling**

Create `styles.css`:

```css
:root { font-family: Inter, ui-sans-serif, system-ui, sans-serif; color: #211b27; background: #f7f3f5; }
* { box-sizing: border-box; }
body { margin: 0; }
main { min-height: 100vh; padding: 24px 18px 40px; }
header { padding: 12px 0 24px; }
h1 { margin: 6px 0 0; font-size: 30px; line-height: 1.05; letter-spacing: -0.04em; }
h2 { font-size: 18px; }
h3 { margin: 0 0 6px; font-size: 14px; }
p { color: #685e6c; line-height: 1.5; }
.eyebrow, .badge { color: #70446f; font-size: 11px; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; }
label { display: grid; gap: 8px; margin: 16px 0; font-weight: 700; }
.check { grid-template-columns: 20px 1fr; align-items: start; font-weight: 500; }
input[type="file"] { width: 100%; padding: 12px; border: 1px solid #d7ccd8; background: white; }
button, .button { display: inline-grid; min-height: 44px; place-items: center; width: 100%; border: 0; border-radius: 8px; padding: 12px 16px; background: #70446f; color: white; font: inherit; font-weight: 800; text-decoration: none; cursor: pointer; }
button:focus-visible, a:focus-visible, input:focus-visible { outline: 3px solid #d69bcf; outline-offset: 3px; }
.secondary { background: #efe5ee; color: #4b2c4a; }
.list { display: grid; gap: 1px; margin: 16px 0 20px; background: #dcd2dc; }
.product { display: grid; gap: 14px; padding: 14px; background: white; }
.product.row { grid-template-columns: 72px 1fr; }
.product img { width: 100%; max-height: 280px; object-fit: contain; background: #f7f3f5; }
.product.row img { width: 72px; height: 88px; }
.product p { margin: 0 0 6px; }
.error { color: #a32335; font-weight: 700; }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; transition: none !important; } }
```

- [ ] **Step 5: Build and test the extension**

```powershell
npm.cmd --prefix extension test
npm.cmd --prefix extension run build
```

Expected: 4 adapter tests pass; `extension/dist/manifest.json`, `extension/dist/sidepanel.html`, `extension/dist/assets/background.js`, and `extension/dist/assets/content.js` exist.

- [ ] **Step 6: Commit the side panel**

```powershell
git add extension/sidepanel.html extension/src/sidepanel
git commit -m "feat: add mocked try-on side panel"
```

---

### Task 5: Documentation and End-to-End Verification

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: commands and build artifacts from Tasks 1–4.
- Produces: a repeatable local setup and manual browser verification path.

- [ ] **Step 1: Write the local setup guide**

Create `README.md` documenting these exact commands:

```powershell
python -m venv backend/.venv
backend/.venv/Scripts/python.exe -m pip install -r backend/requirements.txt
$env:PYTHONPATH='backend'
backend/.venv/Scripts/python.exe -m uvicorn app.main:app --reload
```

In a second terminal:

```powershell
npm.cmd --prefix extension install
npm.cmd --prefix extension run build
```

Then document Chrome loading:

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Choose **Load unpacked**.
4. Select `extension/dist`.
5. Open a search/category listing on Amazon India, Amazon US, Flipkart, or Nykaa.
6. Click the extension action and complete local profile consent.
7. Confirm all generated imagery is labeled `Mock AI preview` and every product link opens its source listing.

State plainly that backend memory resets on restart, the selected profile remains only in Chrome local extension storage, the service-account key is unused, and no live AI or 3D feature exists in this slice.

- [ ] **Step 2: Run all automated checks from a clean build state**

```powershell
$env:PYTHONPATH='backend'
backend/.venv/Scripts/python.exe -m unittest backend.tests.test_api -v
npm.cmd --prefix extension test
npm.cmd --prefix extension run build
git check-ignore -v my-product-sa-key.json
git diff --check
```

Expected: 2 backend tests pass, 4 adapter tests pass, the extension build succeeds, the key is ignored, and `git diff --check` prints nothing.

- [ ] **Step 3: Inspect build artifacts and repository status**

```powershell
Get-Item extension/dist/manifest.json, extension/dist/sidepanel.html, extension/dist/assets/background.js, extension/dist/assets/content.js
git status --short
```

Expected: all four artifacts exist. The specification source files may remain untracked because they predate implementation; `my-product-sa-key.json` must not appear.

- [ ] **Step 4: Commit documentation**

```powershell
git add README.md extension/package-lock.json
git commit -m "docs: add local demo setup"
```

- [ ] **Step 5: Perform manual Chrome verification when Chrome control is available**

Load `extension/dist`, visit one listing page on each supported site, and record whether product count, title, image, price, and source link are extracted. DOM selectors are inherently site-version-sensitive; if a live page differs from the representative fixture, update only that site's adapter and fixture, then rerun the four adapter tests and build.
