# README and branding design

Date: 2026-08-17

## Goal

Replace the working-notes README with a professional project README that presents
Yourdrobe as a finished product, and add the brand assets that README needs. The
document must communicate the depth of the Perfect Corp YouCam integration, because
that integration is the substance of the project.

## Naming and brand

The product keeps the name **Yourdrobe**. It already appears in the extension
manifest, the side-panel header, the local storage key prefixes, and the remote
repository name, so a rename would cost churn without buying anything.

The tagline is **"Your fitting room, anywhere."**, lifted from the existing
side-panel heading so the README and the shipped UI agree.

The brand system is not invented. It is extracted from
`extension/src/sidepanel/styles.css`, which already defines the palette the product
ships with:

| Token | Value | Role |
| --- | --- | --- |
| `--color-primary` | `#f43f7a` | Primary pink |
| `--color-primary-dark` | `#d92d68` | Pressed and active states |
| `--color-ai-purple` | `#7c5cfa` | AI accent |
| `--gradient-ai` | `#f43f7a` to `#ff5d9a` to `#7c5cfa` | Brand gradient |
| `--color-text-primary` | `#222222` | Wordmark on light |
| `--color-text-secondary` | `#6f6f76` | Tagline |

The side panel already renders a `Y` brand mark and a `✦` sparkle motif. The logo
formalises both rather than replacing them.

## Assets

Three hand-authored SVG files under `docs/assets/`:

| File | Contents | Use |
| --- | --- | --- |
| `mark.svg` | Rounded tile, brand gradient, hanger glyph whose shoulders read as a `Y`, sparkle accent | README hero, future extension action icon |
| `logo.svg` | Horizontal lockup: mark, `YOURDROBE` wordmark, tagline, dark text | Light backgrounds |
| `logo-dark.svg` | Same lockup with light text | Dark backgrounds |

All three are pure vector geometry with no external references, no raster embeds,
and no script, so they render identically on GitHub and stay diffable in review.

The README hero pairs `mark.svg` with a Markdown heading rather than embedding the
wordmark as SVG text. SVG `<text>` depends on fonts present on the reader's machine,
so the product name would render inconsistently. A heading always renders correctly.
The text-bearing lockups still ship for use outside the README.

## README structure

1. Hero: centered mark, product name, tagline, one-sentence positioning line
2. Badge row
3. Table of contents
4. What Yourdrobe does: short prose plus a feature table
5. YouCam integration depth: the section that carries the project's weight
6. System architecture diagram
7. Workflow diagrams
8. Repository layout
9. Prerequisites
10. Setup: backend, extension, loading into Chrome
11. Running: mock mode and live YouCam mode
12. Configuration reference
13. API reference
14. Support matrix: retailers and product types
15. Privacy and data handling
16. Testing
17. Troubleshooting
18. Known limitations

### Prose constraints

No emoji anywhere. No em dashes anywhere. Both constraints are checked before each
commit.

### Badges

Static `shields.io` badges for facts verifiable from the repository: Python,
FastAPI, React, TypeScript, Vite, Manifest V3, Vitest, and a Perfect Corp YouCam
tag. Badge colors are drawn from the brand palette so the row reads as one system.

No license badge is included. The repository has no `LICENSE` file, so a license
badge would assert something untrue.

No screenshots are included, because genuine ones cannot be produced here and
placeholders would misrepresent the product.

## Diagrams

Mermaid, rendered natively by GitHub. Text based, so they stay diffable, adapt to
the reader's theme, and need no build step or binary assets.

| Diagram | Type | Shows |
| --- | --- | --- |
| System architecture | `flowchart` | Browser surfaces, local storage, localhost backend, YouCam edge, and the trust boundary where API keys stop |
| Try-on request lifecycle | `sequenceDiagram` | Session, profile, normalize, batch, the 2s poll loop with its 80s deadline, and result re-hosting |
| Outfit composition loop | `flowchart` | How each saved YouCam result becomes the next call's source image |
| Task routing | `flowchart` | How a product type selects the Clothes V3, Shoes, or Hat endpoint |
| Finalize to cart | `stateDiagram-v2` | Per product navigation, add to cart, and the honest stop on size, sign in, or CAPTCHA |

## YouCam integration section

This section is the reason the README exists. It documents, with file references:

1. Three YouCam API families driven from one flow: Clothes V3, Shoes, and Hat
2. Automatic garment category routing from the product classifier to
   `upper_body`, `lower_body`, or `full_body`
3. The full three-step server to server upload protocol: request upload metadata,
   PUT the binary to the presigned URL using the returned headers, then create the
   task against `src_file_id` and `ref_file_url`
4. Multi-key rotation that tries keys in order, retries on 401, 403, 429, and 5xx,
   and distinguishes rate limiting from key exhaustion
5. Provider error normalisation into four actionable classes
6. Task polling that routes to the correct endpoint per task kind and treats
   transient network failure as still processing rather than as failure
7. Result re-hosting with an S3 host allowlist, redirect blocking, content type
   enforcement, and a size ceiling, which is what makes results survivable after
   the provider URL expires
8. The composition loop, where a YouCam result is fed back as the next YouCam source
9. Preview model selection for the Shoes and Hat endpoints
10. Mock and live parity on one job contract, with no silent fallback to mock once
    keys are configured

## Provider scope

The README presents the YouCam integration and nothing else as the try-on engine,
which is accurate: YouCam is the only provider used for product previews.

Profile creation calls a separate image generation service. The README describes
that step provider-neutrally, consistent with the existing provider-neutral consent
copy. Its environment variables are listed in the configuration reference, because
omitting them would leave a reader unable to complete profile setup, which gates
the entire flow.

## Delivery

Micro-commits, each pushed to `origin/feature/hackathon-slice`:

1. Spec
2. Brand assets
3. Hero, badges, contents
4. Overview and YouCam integration section
5. Architecture and workflow diagrams
6. Prerequisites, setup, and run modes
7. Configuration and API reference
8. Support matrix, privacy, testing, troubleshooting, limitations

## Verification

Before each commit: confirm no emoji and no em dash, confirm every referenced file
path exists, and confirm every Mermaid block declares a valid diagram type.
