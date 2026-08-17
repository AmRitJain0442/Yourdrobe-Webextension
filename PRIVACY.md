# Yourdrobe AI Try-On Privacy Policy

Effective date: August 17, 2026

Yourdrobe AI Try-On is a proof-of-concept Chrome extension that helps you preview supported
shopping products on photos you choose. This policy explains what the extension handles, why it
handles it, and where that data goes.

## Data the extension handles

Yourdrobe handles only data needed for its user-facing try-on and outfit features:

- photos you choose for profile creation and virtual try-on;
- optional profile attributes you enter, such as clothing sizes and body measurements;
- visible product information from supported Amazon, Flipkart, and Nykaa pages, including product
  titles, types, prices, image URLs, and product URLs;
- generated profile views, try-on results, saved outfits, consent choices, and related local
  metadata; and
- basic request metadata automatically processed by the hosting provider, such as IP address,
  timestamp, response status, and user agent.

Yourdrobe does not collect passwords, payment-card information, retailer cookies, or the contents
of pages outside its declared supported shopping sites.

## How data is used

Yourdrobe uses this data only to:

- read products visible on the supported shopping page you are using;
- create the profile views you explicitly request;
- generate virtual try-on previews you explicitly request;
- save profiles and outfits locally in your Chrome profile; and
- add products you select to the corresponding retailer cart.

Yourdrobe does not sell user data, use it for advertising, or use it to determine credit,
employment, insurance, or other eligibility.

## Local storage

Profile photos, generated profile views, saved outfits, consent choices, and related metadata are
stored locally using IndexedDB and `chrome.storage.local`. They remain until you delete them in
Yourdrobe, clear the extension's site data, or uninstall the extension.

## Cloud processing and sharing

When you explicitly request profile generation or a try-on, the required photo and product data
are sent over HTTPS to the Yourdrobe API hosted on Google Cloud Run. The API then sends only the
data required for that operation to:

- Google Vertex AI, for generating requested profile views; and
- Perfect Corp YouCam API, for supported virtual try-on previews.

These providers process data on Yourdrobe's behalf to return the requested output. Their handling
is also governed by their applicable service and privacy terms:

- [Google Cloud Privacy](https://cloud.google.com/terms/cloud-privacy-notice)
- [Perfect Corp Privacy Policy](https://www.perfectcorp.com/business/privacy-policy)

The Yourdrobe backend does not intentionally persist raw profile photos after completing a
request. It keeps limited session, product, and job metadata in volatile memory for the active POC
flow; that state is bounded, may be evicted, and is cleared whenever the service restarts. Hosting
and processing providers may retain operational or processed data under their own applicable
terms.

## Security

Cloud requests use HTTPS. Provider credentials remain in Google Cloud Secret Manager and are not
included in the extension. Because this is an unauthenticated proof of concept, do not upload a
photo or enter attributes you are not comfortable sending to the processors listed above.

## Your choices

You control when photos are selected and when cloud generation or try-on begins. You can delete
individual profile assets, delete the complete local profile, reset saved outfits, or uninstall
the extension. The POC does not create user accounts, so the service does not maintain an
account-linked cloud profile.

## Contact

For privacy questions, open an issue in the
[Yourdrobe GitHub repository](https://github.com/AmRitJain0442/Yourdrobe-Webextension/issues).
Do not include photos, measurements, API keys, or other sensitive information in a public issue.

## Changes

Material changes to these practices will be reflected in this policy and, where required, in the
extension interface and Chrome Web Store disclosures before the changed collection begins.
