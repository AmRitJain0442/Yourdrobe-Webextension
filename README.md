<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/logo-dark.svg">
  <img src="docs/assets/logo.svg" alt="Yourdrobe" width="420">
</picture>

### Try clothes on yourself while you shop, without leaving the store.

Yourdrobe is a Chrome side panel that reads product listings from Amazon, Flipkart, and Nykaa,
renders them onto a photo of you with the **Perfect Corp YouCam API**, and stacks each result
into one complete outfit that it can push straight to the retailer's cart.

<br>

[![Try-on engine](https://img.shields.io/badge/Try--on_engine-Perfect_Corp_YouCam-f43f7a?style=flat-square)](https://docs.perfectcorp.com/)
[![YouCam APIs](https://img.shields.io/badge/YouCam_APIs-Clothes_V3_·_Shoes_·_Hat-ff5d9a?style=flat-square)](https://docs.perfectcorp.com/reference/ai_clothes/section/overview)
[![Manifest V3](https://img.shields.io/badge/Chrome-Manifest_V3-4285F4?style=flat-square&logo=googlechrome&logoColor=white)](extension/public/manifest.json)

[![Python](https://img.shields.io/badge/Python-3.10+-3776AB?style=flat-square&logo=python&logoColor=white)](backend/requirements.txt)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.116-009688?style=flat-square&logo=fastapi&logoColor=white)](backend/app/main.py)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black)](extension/package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-7-3178C6?style=flat-square&logo=typescript&logoColor=white)](extension/tsconfig.json)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?style=flat-square&logo=vite&logoColor=white)](extension/vite.config.ts)
[![Tests](https://img.shields.io/badge/Tests-Vitest_+_unittest-7c5cfa?style=flat-square&logo=vitest&logoColor=white)](#testing)

</div>

---

## Contents

- [What Yourdrobe does](#what-yourdrobe-does)
- [Inside the YouCam integration](#inside-the-youcam-integration)
- [System architecture](#system-architecture)
- [Workflows](#workflows)
  - [Try-on request lifecycle](#try-on-request-lifecycle)
  - [Outfit composition loop](#outfit-composition-loop)
  - [YouCam task routing](#youcam-task-routing)
  - [Finalize to cart](#finalize-to-cart)
- [Repository layout](#repository-layout)
- [Prerequisites](#prerequisites)
- [Setup](#setup)
- [Running Yourdrobe](#running-yourdrobe)
- [Configuration reference](#configuration-reference)
- [API reference](#api-reference)
- [Support matrix](#support-matrix)
- [Privacy and data handling](#privacy-and-data-handling)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)
- [Known limitations](#known-limitations)

---

## What Yourdrobe does

You browse a normal product listing. Yourdrobe reads the cards on that page, and every
recognized product grows its own try-on action. Pick one, and it comes back rendered on you.
Save it, pick the next product, and the new preview builds on top of the last one. When the
look is finished, Yourdrobe drives the same tab through each product and adds it to the cart.

| Capability | What it means |
| --- | --- |
| Shop in place | Content-script adapters read product cards straight from Amazon India, Amazon US, Flipkart, and Nykaa listings |
| Search from the panel | Choose a store, type a query, and the active tab navigates to those results with up to 25 products per page |
| One product at a time | Every recognized card carries its own try-on action, so only the item you choose is sent for rendering |
| Layered outfits | Each saved YouCam result becomes the source image for the next call, so a top, a bottom, shoes, and a hat compose into one look |
| Wardrobe history | Up to 50 compiled looks are kept on device and browsable in a carousel that restores both the image and its product list |
| One-tab checkout | Finalize walks the current tab through every selected product, uses the retailer's own add-to-cart control, and ends on the cart |
| Local by default | Profile photos, outfits, and metadata stay in IndexedDB and `chrome.storage.local` on your machine |

---

## Inside the YouCam integration

The try-on engine is the Perfect Corp YouCam API, and it is the substance of this project.
Yourdrobe does not call one endpoint and render the answer. It drives three different YouCam
task families from a single flow, routes each product to the right one automatically, and
wraps the whole thing in key rotation, error classification, and result persistence.

All of the provider code lives in [`backend/app/youcam.py`](backend/app/youcam.py).

### Three YouCam task families, one flow

| Product type | YouCam API | Task endpoint | Parameters sent |
| --- | --- | --- | --- |
| `top`, `outerwear` | Clothes V3 | `/s2s/v2.0/task/cloth-v3` | `garment_category=upper_body` |
| `bottom` | Clothes V3 | `/s2s/v2.0/task/cloth-v3` | `garment_category=lower_body` |
| `dress` | Clothes V3 | `/s2s/v2.0/task/cloth-v3` | `garment_category=full_body` |
| `footwear` | Shoes | `/s2s/v2.0/task/shoes` | `gender`, `style` |
| `headwear` | Hat | `/s2s/v2.0/task/hat` | `gender`, `style` |

### Automatic garment category routing

A product title never states its garment category, so Yourdrobe derives it. A regex classifier
in [`extension/src/product-type.ts`](extension/src/product-type.ts) maps the listing title to one
of fifteen product types, deliberately returning `unknown` when two rules both match rather than
guessing. The backend then maps that type onto the correct YouCam endpoint and category through
`YOUCAM_MAPPING` in [`backend/app/main.py`](backend/app/main.py). A blazer and a hoodie both reach
Clothes V3 as `upper_body`, a saree reaches it as `full_body`, and a pair of loafers is handed to
the Shoes API instead. Ambiguous products stop and ask the shopper rather than sending a wrong
category.

### The full server-to-server upload protocol

YouCam does not accept image bytes on the task endpoint. Yourdrobe implements the complete
three-step handshake in `_create_task`:

1. `POST` the file metadata (content type, file name, byte length) to the file endpoint and
   receive a `file_id` together with a presigned upload request.
2. `PUT` the raw image bytes to that presigned URL, replaying the exact headers YouCam returned.
3. `POST` the task, binding the uploaded `src_file_id` to the retailer's `ref_file_url`.

The same three steps serve Clothes V3, Shoes, and Hat, with only the path and the parameter
dictionary changing, so adding a fourth YouCam family is a small change rather than a rewrite.

### Multi-key rotation with failure classification

`YOUCAM_API_KEYS` accepts a comma separated list. Keys are deduplicated, preserved in order, and
tried in sequence. Any `401`, `403`, `429`, or `5xx` moves to the next key instead of failing the
request, and a transport error does the same.

What makes this useful is that the loop remembers *why* every key failed. If every key answered
`429`, the caller gets `youcam_rate_limited` and is told to retry shortly. If the failures were
mixed, the caller gets `youcam_keys_exhausted`, which is a configuration problem, not a timing
one. Two very different fixes, two different messages.

### Provider errors normalized into actionable classes

YouCam reports failures through varied codes across its endpoints. Rather than leaking them to
the UI, `_error_code` folds them into four classes by inspecting the provider code:

| Class | Triggered by | What the shopper is told |
| --- | --- | --- |
| `provider_safety_rejection` | codes containing `nsfw` or `safety` | The request was rejected for safety reasons |
| `invalid_product_image` | codes containing `ref` or `download` | That product image could not be used |
| `invalid_user_image` | codes containing `src`, `pose`, `image`, or `face` | That photo of you could not be used |
| `provider_processing_failed` | anything else | The preview could not be completed |

Each class maps to a message that tells the shopper which input to change.

### Polling that knows which task it started

A started task records its `task_id`, the index of the key that created it, and its task kind.
Polling in `get_task` uses the stored kind to hit the matching status endpoint, and it reuses the
same key that created the task, since a task is not visible to a different key.

Transient network failure during polling reports `processing` rather than `failed`, so a dropped
packet does not throw away a render that is still running on YouCam's side.

### Results re-hosted so outfits survive

YouCam result URLs expire. If Yourdrobe stored the URL, saved outfits would rot. Instead
`download_result` streams the result through the backend under strict conditions:

- The host must match `yce-*.s3-accelerate.amazonaws.com`, enforced as an allowlist
- The scheme must be HTTPS and redirects are not followed
- The response must be `image/jpeg` or `image/png`
- Streaming aborts past 10 MB

The extension saves those bytes locally, which is what makes the wardrobe durable and the
composition loop possible.

### The composition loop

This is the feature the rest of the integration exists to support. When a preview is saved, its
bytes become `outfit_base_image_data_url` on the next `/v1/tryons/batch` call. That means the
second YouCam request does not render a bottom onto your original photo. It renders it onto the
image YouCam already produced wearing the top.

A shopper can chain Clothes V3, then Shoes, then Hat, and finish with one image wearing all
three. Because the active outfit stands in for the profile photo, the backend also relaxes its
`full_body_front` requirement whenever an outfit base is supplied.

### Preview model selection for Shoes and Hat

The Shoes and Hat endpoints take a `gender` parameter that shapes the rendered model. Yourdrobe
surfaces this as a Women or Men choice on those cards, and the try-on action stays disabled until
the choice is made, so the request is never sent with a parameter YouCam would reject.

### Mock and live parity

With no keys configured the backend serves the identical job contract with `mock: true`, letting
the entire flow be developed and tested without spending provider units. The moment keys are
present, mock is gone: a provider failure stays a failure and is reported as one. Yourdrobe never
quietly serves a fake preview while pretending it is real.
