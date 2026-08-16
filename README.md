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
6. Click the extension action and complete local profile consent.
7. Run the mock or live flow for a supported listing as described below. Product links continue to open their source listing.

## Live YouCam clothing previews and privacy

- Live YouCam supports clothing only: top, outerwear, bottom, and dress.
- Unsupported categories show a failure in live mode.
- `Mock AI preview` appears only when no `YOUCAM_API_KEYS` are configured.
- Once keys are configured, provider or product-image failures remain failures and never fall back to mock imagery.
- The first live run requires separate Perfect Corp cloud-processing consent in addition to local profile consent.
- Profile creation remains file-upload-only; guided camera capture is not implemented.
- Required profile and retailer product images are sent to Perfect Corp for live processing. Perfect Corp may retain uploaded and generated assets for up to 30 days.
- Generated result URLs expire after two hours. Yourdrobe does not persist them: live results remain available only for the current side-panel session.
- Profile photos remain browser-local in Chrome; profile metadata remains in `chrome.storage.local`.

See the official [Clothes V3 API](https://docs.perfectcorp.com/reference/ai_clothes/section/overview) and [file retention period](https://docs.perfectcorp.com/develop/file_retention_period) documentation.

## Manual real-key smoke test

This is a manual check only. It consumes provider units and is never run in CI.

1. In a private shell, configure one real key using the live-mode setup above and start the backend.
2. Build or reload the unpacked extension.
3. Open a supported top or dress listing.
4. Upload the required profile file and accept cloud processing when prompted.
5. Confirm the result is labelled `YouCam AI preview` and the source listing remains accessible.
6. Repeat with an intentionally invalid first key followed by the valid key in `YOUCAM_API_KEYS`; confirm the valid key succeeds without exposing either key.
7. Confirm an invalid product image shows a failure and never `Mock AI preview`.

## Automated verification

Run these commands from the repository root. They use no network provider calls:

```powershell
$env:PYTHONPATH='backend'
backend\.venv\Scripts\python.exe -m unittest backend.tests.test_youcam backend.tests.test_api -v
npm.cmd --prefix extension test
npm.cmd --prefix extension run build
git diff --check
git status --short --branch
```

Expected: both backend modules pass, all extension tests pass, the production build succeeds, `git diff --check` prints nothing, and only the intended documentation change is present before commit.
