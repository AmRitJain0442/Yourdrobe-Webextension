# Chrome Web Store listing

## Product details

- **Name:** Yourdrobe AI Try-On
- **Category:** Shopping
- **Language:** English
- **Summary:** Preview supported fashion products on your photos and build an outfit without leaving the shopping tab.
- **Homepage:** https://github.com/AmRitJain0442/Yourdrobe-Webextension
- **Support:** https://github.com/AmRitJain0442/Yourdrobe-Webextension/issues
- **Privacy policy:** https://github.com/AmRitJain0442/Yourdrobe-Webextension/blob/feature/hackathon-slice/PRIVACY.md

## Detailed description

Turn supported shopping pages into an AI fitting room.

Yourdrobe reads the products visible on Amazon, Flipkart, and Nykaa listing pages and lets you
request a virtual preview from Chrome's side panel. Create a reusable profile from a photo you
choose, try supported clothing, footwear, and headwear, layer successful previews into an active
outfit, and send selected products back to the retailer cart.

Key features:

- Works alongside supported shopping pages in Chrome's side panel.
- Extracts visible product cards without replacing the retailer experience.
- Creates requested profile views and AI try-on previews.
- Keeps saved profile and outfit assets in browser-local storage.
- Supports outfit layering and retailer cart handoff.
- Clearly labels mock and live AI previews.

Your photos and relevant product information are transmitted to the Yourdrobe cloud service and
its disclosed AI processing providers only when needed for a feature you request. AI previews are
illustrative and do not guarantee garment fit, sizing, appearance, availability, or price.

This release is a proof of concept. Availability may depend on provider capacity and supported
product imagery.

## Single purpose

Help users preview supported products from the shopping page they are viewing on a locally saved
photo profile and assemble selected previews into an outfit.

## Permission justifications

- **sidePanel:** Displays the product picker, profile controls, try-on results, and saved wardrobe
  beside the active shopping tab.
- **storage:** Stores user-selected profile assets, consent choices, active outfits, and saved
  wardrobe data locally in the user's Chrome profile.
- **amazon.in / amazon.com / flipkart.com / nykaa.com:** Reads visible product cards on supported
  listing pages and performs user-requested cart handoff on those retailers.
- **yourdrobe-api-jiayjiprgq-el.a.run.app:** Sends user-requested profile and try-on operations to
  the hosted API and retrieves their results.

## Privacy disclosures

Declare the following data types because the extension handles them for its single purpose:

- **Personally identifiable information:** user-provided photos and body/profile attributes can
  identify a person.
- **Website content:** visible product titles, prices, images, and links from supported pages.
- **Web browsing activity:** the current supported retailer URL is used to identify and process the
  page on which the user invokes the extension.
- **User-generated content:** profile photos, generated views, try-on results, and saved outfits.

Certifications:

- Data is used only to provide the extension's disclosed try-on and outfit features.
- Data is not sold or transferred for advertising.
- Data is not used for lending, credit, insurance, employment, or similar eligibility decisions.
- Humans do not read user content except when the user explicitly supplies specific content for a
  support request, when required for security, or when required by law.

## Test instructions

1. Install the extension and open an Amazon India, Amazon US, Flipkart, or Nykaa search/listing page.
2. Select the Yourdrobe toolbar action to open the side panel.
3. Choose a clear full-body photo and review the cloud-processing disclosure before continuing.
4. Save the generated profile, select a supported product, and accept try-on processing when prompted.
5. Review the generated preview and optionally add it to the active outfit.

No test account or password is required. Live generation consumes shared POC provider quota; if a
provider quota is temporarily unavailable, the extension presents an actionable error.
