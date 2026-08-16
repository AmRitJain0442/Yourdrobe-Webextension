# Yourdrobe local demo

## Setup

From the repository root, create the backend environment and install its dependencies:

```powershell
python -m venv backend/.venv
backend/.venv/Scripts/python.exe -m pip install -r backend/requirements.txt
```

Install the extension dependencies and build the unpacked extension in a second terminal:

```powershell
npm.cmd --prefix extension install
npm.cmd --prefix extension run build
```

### Mock mode (default)

To force mock mode, including when `backend/.env` has keys, set a comma-only process value before starting or restarting Uvicorn. It stays present in Windows PowerShell 5.1, takes precedence, and parses as zero keys without changing the local file:

```powershell
$env:YOUCAM_API_KEYS=','
$env:PYTHONPATH='backend'
backend/.venv/Scripts/python.exe -m uvicorn app.main:app --reload --port 8001
```

The backend then stays offline and returns results labelled `Mock AI preview`.

### Live YouCam mode

Copy the backend example file and add one or more real keys:

```powershell
Copy-Item backend/.env.example backend/.env
# Edit backend/.env and set YOUCAM_API_KEYS=first-api-key,second-api-key
$env:PYTHONPATH='backend'
backend/.venv/Scripts/python.exe -m uvicorn app.main:app --reload --port 8001
```

Keys are tried in the order listed. Never commit keys or bundle them into the extension. A PowerShell process variable remains an optional higher-priority override:

```powershell
$env:YOUCAM_API_KEYS='first-api-key,second-api-key'
```

## Load the extension in Chrome

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Choose **Load unpacked**.
4. Select `extension/dist`.
5. Open a search or category listing on Amazon India, Amazon US, Flipkart, or Nykaa.
6. Click the extension action, upload the five required profile photos, and complete local profile consent.
7. Run the mock or live flow for a supported listing as described below. Product links continue to open their source listing.

The side panel can search Amazon India, Amazon US, Flipkart, or Nykaa for you. Choose a store, enter a product query, and Yourdrobe navigates the current tab to that store's search page before showing up to five retailer-ranked results in the panel. When an active outfit is saved and the new results include clothing, the action changes to **Add these products to active outfit**.

## Live YouCam clothing previews and privacy

- Live YouCam supports clothing only: top, outerwear, bottom, and dress.
- A profile requires exactly five uploads: front, left, and right face photos plus front and side full-body photos.
- Yourdrobe does not ask for body measurements or clothing sizes.
- Live clothing uses the front full-body profile photo when starting from the original profile photo.
- Unsupported categories show a failure in live mode.
- `Mock AI preview` appears only when no `YOUCAM_API_KEYS` are configured.
- Once keys are configured, provider or product-image failures remain failures and never fall back to mock imagery.
- The first live run requires separate Perfect Corp cloud-processing consent in addition to local profile consent.
- Profile creation remains file-upload-only; guided camera capture is not implemented.
- Required profile and retailer product images are sent to Perfect Corp for live processing. Perfect Corp may retain uploaded and generated assets for up to 30 days.
- A completed live preview can be saved with **Use as active outfit**. Yourdrobe downloads and stores one rendered image browser-locally; it does not store the provider result URL.
- Later live clothing previews use the active outfit as their source. Products in one batch are alternatives, not an automatic composition chain: save one result, then start a later preview to compose it.
- **Reset to original profile photo** removes the active outfit. Deleting the complete profile removes it too.
- Sequential raster edits can alter previously rendered items, so a later preview is not a lossless edit of the earlier one.
- Shoes and accessories remain future provider-specific integrations.
- Provider result URLs expire after two hours. Saving a rendered result can fail after its temporary provider URL expires; unsaved live results remain available only for the current side-panel session.
- Profile photos, active outfits, and profile metadata are stored locally in this Chrome browser on this device. Using an active outfit for another live preview uploads its saved image to Perfect Corp.

See the official [Clothes V3 API](https://docs.perfectcorp.com/reference/ai_clothes/section/overview) and [file retention period](https://docs.perfectcorp.com/develop/file_retention_period) documentation.

## Manual real-key smoke test

This is a manual check only. It consumes provider units and is never run automatically.

1. In a private shell, configure one real key using the live-mode setup above and start the backend.
2. Build or reload the unpacked extension.
3. Open a supported top listing, upload the five required profile photos, and accept cloud processing when prompted.
4. Confirm the result is labelled `YouCam AI preview`, then select **Use as active outfit**.
5. Search for a bottom such as baggy jeans in the side panel and confirm **Add these products to active outfit** appears and its live preview runs from the saved active outfit.
6. Select **Reset to original profile photo** and confirm the active outfit is removed.

## Automated verification

Run these commands from the repository root. They use no network provider calls:

```powershell
$env:PYTHONPATH='backend'
backend\.venv\Scripts\python.exe -m unittest backend.tests.test_youcam backend.tests.test_api -v
npm.cmd --prefix extension test
npm.cmd --prefix extension run build
git diff --check
git diff --check e19aa3e..HEAD
git status --short --branch
```

Expected: both backend modules pass, all extension tests pass, the production build succeeds, both diff checks print nothing, and only intended changes are present before commit.
