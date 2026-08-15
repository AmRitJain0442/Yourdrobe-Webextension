# Yourdrobe local demo

## Setup

From the repository root, create the backend environment and start the local API:

```powershell
python -m venv backend/.venv
backend/.venv/Scripts/python.exe -m pip install -r backend/requirements.txt
$env:PYTHONPATH='backend'
backend/.venv/Scripts/python.exe -m uvicorn app.main:app --reload
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

The backend uses bounded memory and resets on restart. The selected profile image is persisted only in Chrome local extension storage, sent to the local backend for each run, and not retained in backend memory. The service-account key is ignored and unused. This slice has no live AI or 3D feature.

## Automated verification

Run these commands from a clean build state:

```powershell
$env:PYTHONPATH='backend'
backend/.venv/Scripts/python.exe -m unittest backend.tests.test_api -v
npm.cmd --prefix extension test
npm.cmd --prefix extension run build
git check-ignore -v my-product-sa-key.json
git diff --check
```

Expected results: the backend tests pass, the extension tests pass, the extension build succeeds, `my-product-sa-key.json` is ignored, and `git diff --check` prints nothing. The current suites contain 11 backend tests and 15 extension tests.

Inspect the generated artifacts and repository status:

```powershell
Get-Item extension/dist/manifest.json, extension/dist/sidepanel.html, extension/dist/assets/background.js, extension/dist/assets/content.js
git status --short
```

All four artifacts should exist. Specification source files may remain untracked because they predate implementation; `my-product-sa-key.json` must not appear.

## Manual browser verification

When Chrome control is available, load `extension/dist` and visit one listing page on each supported site. Record whether product count, title, image, price, and source link are extracted. DOM selectors are site-version-sensitive. If a live page differs from its representative fixture, update only that site's adapter and fixture, then rerun the four adapter tests and the build.
