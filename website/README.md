# Truber website

## What this is

The static public marketing site for Truber, a Zimbabwe-first freight marketplace for shippers and transporters. It uses plain HTML and CSS with two tiny progressive-enhancement JS files. There is no framework, build, server code, environment values, API calls or third-party requests.

## Run locally

```sh
npx serve website
```

Clean URLs work under `serve` and Vercel. Alternatively, use Python (`.html` URLs are required):

```sh
python3 -m http.server -d website 8080
```

## File structure

| File | Purpose |
| --- | --- |
| `404.html` | Not-found page. |
| `about.html` | About Truber. |
| `apple-touch-icon.png` | iOS home-screen icon; derived (resized from the user-supplied `icon-black-tile.png`). |
| `assets/icon-16.png` | 16 px favicon PNG; derived (resized from the user-supplied `icon-black-tile.png`). |
| `assets/icon-32.png` | 32 px favicon PNG; derived (resized from the user-supplied `icon-black-tile.png`). |
| `assets/icon-48.png` | 48 px icon PNG; derived (resized from the user-supplied `icon-black-tile.png`). |
| `assets/icon-192.png` | 192 px web-app manifest icon; derived (resized from the user-supplied `icon-black-tile.png`). |
| `assets/icon-512.png` | 512 px web-app manifest icon; derived (resized from the user-supplied `icon-black-tile.png`). |
| `assets/logo/icon-transparent.png` | User-supplied official T mark, byte-identical copy of the original; home hero. |
| `assets/logo/wordmark-white-transparent.png` | User-supplied official wordmark, byte-identical copy of `design/website/assets/user-logos-2026-11-10/wordmark-white-transparent.png`; header and footer, sized in CSS. |
| `become-a-transporter.html` | Transporter application page with a demo form. |
| `contact.html` | Contact page with a demo enquiry form. |
| `favicon.ico` | Browser tab icon; derived (resized from the user-supplied `icon-black-tile.png`). |
| `forms.js` | Enables demo submit buttons and blocks submission with a “Demo: not sent” message. |
| `how-it-works.html` | Shipper and transporter flows. |
| `index.html` | Home page. |
| `og-image.png` | 1200 × 630 social image; derived (composed from the user-supplied icon and wordmark on `#000000`), including the tagline. |
| `README.md` | This guide, excluded from deploys. |
| `register.html` | Account registration demo form. |
| `robots.txt` | Search-crawler rules; allows crawling and points to the sitemap. |
| `safety.html` | Safety and trust information. |
| `services.html` | Planned services cards. |
| `sign-in.html` | Sign-in demo form. |
| `site.webmanifest` | Web-app name, colours and icons. |
| `sitemap.xml` | Public page URLs. |
| `styles.css` | Layout and component styles using design tokens only, with no hex values. |
| `theme.js` | System/Light/Dark theme toggle. |
| `tokens.css` | Colour and design tokens. |
| `vercel.json` | Clean URLs and security headers, including the CSP. |

## Editing services cards

Edit `services.html` only between `<!-- SERVICES DATA -->` and `<!-- END SERVICES DATA -->`. Each `li.service-card` must keep the “Planned” badge. Only add services supported by `CONCEPT.md`.

## Tokens and colour

`tokens.css` is a verbatim copy of Truber Design’s `design/website/tokens-2026-11-10.css` (confirmed by Design on 10 November 2026, 14:33 CAT). The user colour decision of 10 November 2026, 14:24 CAT was: “Blue bar #0035FE, White #FEFEFE, Background #000000”.

`tokens.css` (the Design file, kept verbatim) lists `Inter` first, but no Inter files are shipped or loaded; browsers fall through to the `system-ui` stack, which is the real font.

Dark mode uses `#6684FF` for links and small accent text, and `#99AEFF` for the focus ring. Primary buttons keep the `#0035FE` fill with a `#FEFEFE` edge ring on black. Raw `#0035FE` is never used as dark-mode text. `styles.css` uses tokens only and contains no hex values. The header and footer are black in both themes because the official wordmark is white.

## Logos

The two logos shipped in the page — `assets/logo/wordmark-white-transparent.png` and `assets/logo/icon-transparent.png` — are the user originals, byte-identical to the supplied files. Verify with `sha256sum` against the Design kit's `design/website/assets/user-logos-2026-11-10/` (outside this repo):

```sh
sha256sum website/assets/logo/wordmark-white-transparent.png \
  design/website/assets/user-logos-2026-11-10/wordmark-white-transparent.png
sha256sum website/assets/logo/icon-transparent.png \
  design/website/assets/user-logos-2026-11-10/icon-transparent.png
```

They are sized with CSS (`height: 32px` for the wordmark) plus `width`/`height` attributes at the intrinsic size (1046 × 292 for the wordmark, 948 × 604 for the T mark). Never recolour, redraw, stretch or replace them.

`wordmark-black-tile.png` and `icon-black-tile.png` are not shipped as-is; `icon-black-tile.png` is the source of the derived favicons. `favicon.ico`, `apple-touch-icon.png` and `assets/icon-*.png` are resized-only derivatives of that file, and `og-image.png` is composed from the user icon and wordmark on `#000000`.

## Theme

With no stored choice, the site follows `prefers-color-scheme`. The `theme.js` toggle shows System/Light/Dark and stores the choice under the `truber-theme` localStorage key.

The single inline head script prevents a flash and is allowed by its SHA-256 hash in the `vercel.json` CSP. If you change it, keep it byte-identical on every page and recompute the hash with:

```sh
python3 -c 'import re,hashlib,base64;s=re.search(r"<script>([^<]*)</script>",open("website/index.html").read()).group(1);print("sha256-"+base64.b64encode(hashlib.sha256(s.encode()).digest()).decode())'
```

## Header and navigation

Desktop navigation shows from 1200px. Below that, a `<details>` Menu button keeps the header to one row from 640px.

## Search indexing

The site is indexable per the user decision of 10 Nov 2026 15:35 CAT: “Merge PR #11 once Mark signs off and let search engines index it”. There is no robots meta and no `X-Robots-Tag`; `robots.txt` allows crawling and points to the sitemap. The production domain is https://truber-web.vercel.app.

### Launch record

- [x] robots meta removed from every page.
- [x] `X-Robots-Tag` removed from `vercel.json`.
- [x] `robots.txt` restored with `Allow: /` and `Sitemap`.
- [x] canonical, `og:url`, `og:image`, `twitter:image` and `sitemap.xml` set to https://truber-web.vercel.app.

Still open:

- [ ] If a custom domain is added later, update those URLs and `robots.txt`.
- [ ] Replace “[support contact TBC]”.

## Demo forms

The `become-a-transporter`, `contact`, `sign-in` and `register` pages each show the banner “Demo only: nothing you enter is sent or stored”. There is no network code anywhere.

Submit buttons are disabled in HTML and enabled by `forms.js`, which prevents submission and shows “Demo: not sent”. With JS off, the button stays disabled and the CSP `form-action 'none'` directive (header and meta) blocks any submission.

## Integration points

Each marker below is a TBD endpoint per `api/openapi.yaml` and is not connected:

- `become-a-transporter.html`: `<!-- INTEGRATION POINT: transporter application endpoint TBD per openapi.yaml; not connected -->`
- `contact.html`: `<!-- INTEGRATION POINT: contact enquiry endpoint TBD per openapi.yaml; not connected -->`
- `register.html`: `<!-- INTEGRATION POINT: registration endpoint TBD per openapi.yaml; not connected -->`
- `sign-in.html`: `<!-- INTEGRATION POINT: sign-in endpoint TBD per openapi.yaml; not connected -->`

## Placeholders

There are 76 placeholder comments in the HTML (count with `grep -o "PLACEHOLDER" -r website --include="*.html" | wc -l`), by kind:

| Kind | Count | Where |
| --- | --- | --- |
| Engineering-drafted copy | 48 | Content blocks across all ten HTML pages. |
| Support contact | 12 | Repeated per page. |
| Social accounts | 10 | Repeated per page. |
| Demo form | 4 | `become-a-transporter.html`, `contact.html`, `register.html`, `sign-in.html`. |
| Truck type list | 1 | `become-a-transporter.html`. |
| Hero illustration | 1 | `index.html`; licensed photography TBC by Truber Design. |

The 48 copy markers sit on content blocks. The support contact and social account markers (12 and 10) repeat on each page.

Truber Design owns the final copy. Design-owned copy is marked `<!-- COPY: design/website/COPY.md -->`.

## Deploy

The Vercel project is `truber-web` (under team `craigmudirira`’s projects), Git-linked to `craigtanatswa/truber`. Set the root directory to `website`, the framework preset to Other, and provide no build command, install command or environment variables. The production branch is `main`.

`vercel.json` sets `cleanUrls` and security headers, including a strict CSP with no external origins. `README.md` is excluded from deploys via `.vercelignore`.

Vercel adds `Access-Control-Allow-Origin: *` to static files on its own; that is fine for a public static site with no private data.

## Checks

Run Lighthouse mobile on every page and require all four categories to score at least 90. Also run:

- `html-validate` with `html-validate:recommended`.
- axe-core via Playwright.
- The contrast script over `tokens.css`.
- Playwright screenshots at 360, 768 and 1280 px, in light and dark themes.
- Network logs to confirm no third-party requests and zero requests on form submit.
- A JS-off check.

Evidence is kept outside the repo at `/home/box/truber/reports/evidence/brian-website/`.
