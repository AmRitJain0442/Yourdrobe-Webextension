# YourDrobe

<p align="center">
  <img src="https://storage.googleapis.com/yourdrobe-public-assets-635367932686/brand/yourdrobe-lockup-banner.png" alt="YourDrobe name and logo" width="420">
</p>

## Description

YourDrobe is a Chrome extension that lets people try on products while they shop on Amazon, Flipkart, and Nykaa. It reads visible product cards from the current page and opens the selected items in a side panel.

The shopper creates a profile from one clear, full-body photo. The extension saves that profile on the device. When the shopper selects an item and agrees to cloud processing, YourDrobe creates a virtual try-on preview. A saved preview becomes the base for the next item, so the shopper can build a complete outfit one product at a time. The final action returns the selected products to the retailer's cart.

## Impact

Online shoppers can see individual products, but they often cannot see how several products work together on them. YourDrobe reduces that gap without asking the shopper to leave the retailer page.

- It compares complete looks instead of isolated products.
- It reuses one local profile, so the shopper does not repeat setup for every item.
- It keeps product selection, previews, saved outfits, and cart handoff in one browser tab.
- It supports branching from a previously saved outfit to test another combination.

The preview is a visual aid. It does not promise exact sizing, fabric behavior, or fit.

## How we integrated the YouCam API

The extension first classifies the selected product. The hosted backend then sends it to the matching Perfect Corp YouCam API:

| Product | YouCam route | Category sent |
| --- | --- | --- |
| Top or outerwear | Clothes V3 | `upper_body` |
| Bottom | Clothes V3 | `lower_body` |
| Dress | Clothes V3 | `full_body` |
| Footwear | Shoes | Gender and style selected in the extension |
| Headwear | Hat | Gender and style selected in the extension |

Each request follows the same flow:

1. The shopper chooses a product and approves cloud processing.
2. The backend validates the request and selects the correct YouCam task type.
3. The backend requests signed upload details from YouCam and uploads the current profile or active outfit.
4. It starts the task with the uploaded image and the retailer's product image URL.
5. It polls the same task with the same API key until the task completes.
6. It validates the returned image and sends the preview back to the side panel.

The API key is stored in Google Secret Manager and is read only by the Cloud Run service. It is never bundled with or returned to the Chrome extension. For this POC, the backend endpoint is public so the extension can work without account setup.

When a shopper saves a preview, YourDrobe uses that generated image as the source for the next YouCam request. This is how a dress can be followed by shoes and then a hat while keeping one active outfit.

## What we used

- Chrome Extensions Manifest V3 for the side panel, content scripts, and cart handoff
- React 19, TypeScript, and Vite for the extension interface
- IndexedDB and `chrome.storage.local` for profiles, outfits, preferences, and consent state
- FastAPI and Python for request validation, task orchestration, polling, and result delivery
- Google Cloud Run for the hosted backend
- Google Secret Manager for the YouCam API key
- Perfect Corp YouCam Clothes V3, Shoes, and Hat APIs for virtual try-on
- Vitest and Python `unittest` for automated tests

## System architecture

![YourDrobe system architecture](https://storage.googleapis.com/yourdrobe-public-assets-635367932686/diagrams/system-architecture.png)

## Example

A shopper opens a page of dresses on Amazon. YourDrobe reads the visible product cards, and the shopper selects one dress in the side panel. After consent, the backend routes the dress to Clothes V3 as `full_body`, waits for the task, and returns the preview.

The shopper saves that result and selects a pair of shoes. The Shoes API receives the saved dress preview as the new source image, so the second result shows both products together. The shopper can add a hat in the same way, compare the completed look with an earlier version, and send the selected dress, shoes, and hat back to the Amazon cart.
