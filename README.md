# Yourdrobe local demo

## Setup

From the repository root, create the backend environment and start the local API:

```powershell
python -m venv backend/.venv
backend/.venv/Scripts/python.exe -m pip install -r backend/requirements.txt
$env:PYTHONPATH='backend'
backend/.venv/Scripts/python.exe -m uvicorn app.main:app --reload --port 8001
```

In a second terminal, install the extension dependencies and build the unpacked extension:

```powershell
npm.cmd --prefix extension install
npm.cmd --prefix extension run build
```

## Load the extension in Chrome

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Choose **Load unpacked**.
4. Select `extension/dist`.
5. Open a search or category listing on Amazon India, Amazon US, Flipkart, or Nykaa.
6. Click the extension action and complete local profile consent.
7. Confirm all generated imagery is labeled `Mock AI preview` and every product link opens its source listing.

## Progressive profile behavior and privacy

- Clicking **Try these products** requests only the missing category-specific photos.
- Users upload files during this phase; guided camera capture is deferred.
- Photos are stored as IndexedDB blobs in Chrome, while profile metadata is stored in `chrome.storage.local`.
- For each try-on/product run, only the required images are sent to the local backend on port `8001`; the backend does not retain them.
- **Manage profile** replaces or deletes individual photos and can delete the complete profile.
- Existing single-photo profiles must be assigned a role once. Attributes are optional and stored locally.
- Product previews remain mocks that reuse product imagery and are labeled `Mock AI preview`.
- YouCam, cloud profiles, and 3D are not present in this slice.

The service-account key is ignored and unused.

## Automated verification

Run these commands from a clean build state:

```powershell
$env:PYTHONPATH='backend'
backend/.venv/Scripts/python.exe -m unittest backend.tests.test_api -v
npm.cmd --prefix extension test
npm.cmd --prefix extension run build
git diff --check
git status --short --branch
```

Expected results: the backend tests pass, the extension tests pass, the extension build succeeds, `git diff --check` prints nothing, and only the intended README change is uncommitted.

Inspect the generated artifacts and repository status:

```powershell
Get-Item extension/dist/manifest.json, extension/dist/sidepanel.html, extension/dist/assets/background.js, extension/dist/assets/content.js
git status --short
```

All four artifacts should exist. Specification source files may remain untracked because they predate implementation; `my-product-sa-key.json` must not appear.

## Manual browser verification

When Chrome control is available, load `extension/dist` and visit one listing page on each supported site. Record whether product count, title, image, price, and source link are extracted. DOM selectors are site-version-sensitive. If a live page differs from its representative fixture, update only that site's adapter and fixture, then rerun the four adapter tests and the build.
