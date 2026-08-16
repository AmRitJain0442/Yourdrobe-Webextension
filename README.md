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
$env:GOOGLE_APPLICATION_CREDENTIALS=''
$env:PYTHONPATH='backend'
backend/.venv/Scripts/python.exe -m uvicorn app.main:app --reload --port 8001
```

The backend then stays offline, disables AI profile generation, and returns results labelled `Mock AI preview`.

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

### Nano Banana profile generation

Keep `my-product-sa-key.json` outside the worktree and point the backend to it from `backend/.env` using an absolute path:

```dotenv
GOOGLE_APPLICATION_CREDENTIALS=D:/hackathons/Yourdrobe-Webextension/my-product-sa-key.json
GOOGLE_CLOUD_LOCATION=global
NANO_BANANA_MODEL=gemini-3.1-flash-image
```

The ignored credential file is read only by Google Application Default Credentials in the backend. It is never copied into the extension, committed, logged, or returned by an API. The service account's project must have Vertex AI enabled and permission to use the configured model.

## Load the extension in Chrome

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Choose **Load unpacked**.
4. Select `extension/dist`.
5. Open a search or category listing on Amazon India, Amazon US, Flipkart, or Nykaa.
6. Click the extension action, upload one clear full-body photo, consent to Google processing, review the five generated photos, and save the generated profile.
7. Run the mock or live flow for a supported listing as described below. Product links continue to open their source listing.

The side panel can search Amazon India, Amazon US, Flipkart, or Nykaa for you. Choose a store, enter a product query, and Yourdrobe navigates the current tab to that store's search page before showing up to five retailer-ranked results in the panel. Each supported clothing card has its own **Try this top**, **Try this bottom**, **Try this dress**, or **Try this outerwear** action, so only the selected item generates a preview.

## Live YouCam clothing previews and privacy

- Live YouCam supports top, outerwear, bottom, and dress through Clothes V3, plus footwear through the separate Shoes API.
- Profile creation accepts one clear full-body upload. Nano Banana generates front, left, and right face photos plus white-background front and side full-body photos at 2K resolution.
- Generation makes five Vertex AI image requests. Review all five AI-generated views before saving because unseen angles, identity details, and body proportions can be inaccurate.
- Yourdrobe does not ask for body measurements or clothing sizes.
- Live clothing uses the front full-body profile photo when starting from the original profile photo.
- Unsupported categories show a failure in live mode.
- `Mock AI preview` appears only when no `YOUCAM_API_KEYS` are configured.
- Once keys are configured, provider or product-image failures remain failures and never fall back to mock imagery.
- The first live run requires separate Perfect Corp cloud-processing consent in addition to local profile consent.
- Profile creation remains file-upload-only; guided camera capture is not implemented. The source photo is sent through the local backend to Google Vertex AI only after explicit consent, and the backend does not persist it.
- Required profile and retailer product images are sent to Perfect Corp for live processing. Perfect Corp may retain uploaded and generated assets for up to 30 days.
- A completed live preview can be saved with **Use as active outfit**. Yourdrobe downloads and stores one rendered image browser-locally; it does not store the provider result URL.
- Later live clothing previews use the active outfit as their source. Select one product card at a time, save its result, then select the next product to compose it.
- The active outfit is shown as a large preview. New product and generated preview choices use a horizontal scrolling gallery.
- Shoe cards ask for a Women or Men preview model and expose **Try these shoes**. The Shoes API uses the active outfit image when one is saved, otherwise it uses the front full-body profile photo.
- Bags, belts, and jewelry are not supported by the current provider workflow. When an active outfit exists, these products can be selected with **Add to outfit without preview** and are included in finalization without pretending that an AI preview was generated.
- **Finalize outfit in this tab** visits each selected product in the current tab and uses its visible Add to Cart or Add to Bag control. After every item is added, that same tab finishes on the last product's retailer cart. If a product requires a size, colour, sign-in, CAPTCHA, or another choice, the sequence stops on that product for manual completion and does not report it as added.
- **Reset to original profile photo** removes the active outfit. Deleting the complete profile removes it too.
- Sequential raster edits can alter previously rendered items, so a later preview is not a lossless edit of the earlier one.
- Additional provider-specific integrations remain future work for bags, belts, and jewelry.
- Provider result URLs expire after two hours. Saving a rendered result can fail after its temporary provider URL expires; unsaved live results remain available only for the current side-panel session.
- Profile photos, active outfits, and profile metadata are stored locally in this Chrome browser on this device. Using an active outfit for another live preview uploads its saved image to Perfect Corp.

See the official [Clothes V3 API](https://docs.perfectcorp.com/reference/ai_clothes/section/overview), [Shoes API](https://docs.perfectcorp.com/reference/ai_shoes), and [file retention period](https://docs.perfectcorp.com/develop/file_retention_period) documentation.

## Manual real-key smoke test

This is a manual check only. It consumes provider units and is never run automatically.

1. In a private shell, configure one real key using the live-mode setup above and start the backend.
2. Build or reload the unpacked extension.
3. Open a supported top listing, upload one full-body source photo, consent to Google Vertex AI processing, and confirm five white-background generated previews appear before anything is saved.
4. Save the generated profile, accept Perfect Corp processing when prompted, confirm the result is labelled `YouCam AI preview`, then select **Use as active outfit**.
5. Search for a bottom such as baggy jeans in the side panel and confirm **Try this bottom** appears under each result and generates only the selected product's preview from the saved active outfit.
6. Search for an accessory, select **Add to outfit without preview**, and confirm it appears in the selected-product list without a failed preview.
7. Select **Finalize outfit in this tab**. Confirm the current tab visits each directly addable product and finishes on the last product's retailer cart. Confirm any product needing a size or other choice stops the sequence on its product page.
8. Select **Reset to original profile photo** and confirm the active outfit and selected-product list are removed.

## Automated verification

Run these commands from the repository root. They use no network provider calls:

```powershell
$env:PYTHONPATH='backend'
backend\.venv\Scripts\python.exe -m unittest backend.tests.test_youcam backend.tests.test_profile_generation backend.tests.test_api -v
npm.cmd --prefix extension test
npm.cmd --prefix extension run build
git diff --check
git diff --check e19aa3e..HEAD
git status --short --branch
```

Expected: both backend modules pass, all extension tests pass, the production build succeeds, both diff checks print nothing, and only intended changes are present before commit.
