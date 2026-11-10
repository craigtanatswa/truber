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
| `apple-touch-icon.png` | iOS home-screen icon, resized from the supplied logo. |
| `assets/icon-16.png` | 16 px favicon PNG. |
| `assets/icon-32.png` | 32 px favicon PNG. |
| `assets/icon-48.png` | 48 px icon PNG. |
| `assets/icon-192.png` | 192 px web-app manifest icon. |
| `assets/icon-512.png` | 512 px web-app manifest icon. |
| `assets/logo/truber-icon-white@1x.png` | White Truber icon, 1x PNG. |
| `assets/logo/truber-icon-white@1x.webp` | White Truber icon, 1x WebP. |
| `assets/logo/truber-icon-white@2x.png` | White Truber icon, 2x PNG. |
| `assets/logo/truber-icon-white@2x.webp` | White Truber icon, 2x WebP. |
| `assets/logo/truber-wordmark-white@1x.png` | White Truber wordmark, 1x PNG. |
| `assets/logo/truber-wordmark-white@1x.webp` | White Truber wordmark, 1x WebP. |
| `assets/logo/truber-wordmark-white@2x.png` | White Truber wordmark, 2x PNG. |
| `assets/logo/truber-wordmark-white@2x.webp` | White Truber wordmark, 2x WebP. |
| `become-a-transporter.html` | Transporter application page with a demo form. |
| `contact.html` | Contact page with a demo enquiry form. |
| `favicon.ico` | Browser tab icon, resized from the supplied logo. |
| `forms.js` | Enables demo submit buttons and blocks submission with a “Demo: not sent” message. |
| `how-it-works.html` | Shipper and transporter flows. |
| `index.html` | Home page. |
| `og-image.png` | 1200 × 630 social image: supplied icon and wordmark on black with the tagline. |
| `README.md` | This guide, excluded from deploys. |
| `register.html` | Account registration demo form. |
| `robots.txt` | Search-crawler rules and sitemap URL. |
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

Dark mode uses `#6684FF` for links and small accent text, and `#99AEFF` for the focus ring. Primary buttons keep the `#0035FE` fill with a `#FEFEFE` edge ring on black. Raw `#0035FE` is never used as dark-mode text. `styles.css` uses tokens only and contains no hex values. The header and footer are black in both themes because the official wordmark is white.

## Logos

`assets/logo/*`, `favicon.ico`, `apple-touch-icon.png` and `assets/icon-*.png` are resized-only derivatives of the user-supplied logos in `design/website/assets/user-logos-2026-11-10/`. They are never recoloured or redrawn. `og-image.png` places the user icon and wordmark on black with the tagline.

## Theme

The site follows `prefers-color-scheme` with no JS. `theme.js` adds a System/Light/Dark toggle and stores the choice under the `truber-theme` localStorage key.

The single inline head script prevents a flash and is allowed by its SHA-256 hash in the `vercel.json` CSP. If you change it, keep it byte-identical on every page and recompute the hash with:

```sh
python3 -c 'import re,hashlib,base64;s=re.search(r"<script>([^<]*)</script>",open("website/index.html").read()).group(1);print("sha256-"+base64.b64encode(hashlib.sha256(s.encode()).digest()).decode())'
```

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

| Placeholder | Pages |
| --- | --- |
| Engineering-drafted copy, to be replaced by Truber Design | All ten HTML pages. |
| Canonical domain not set; current value `https://truber-web.vercel.app` | All pages except `404.html`. |
| Support contact “`[support contact TBC]`” | All ten HTML pages. |
| Social links (coming soon, not links) | All ten HTML pages. |
| Hero illustration (licensed photography TBC) | `index.html`. |
| Demo forms | `become-a-transporter.html`, `contact.html`, `register.html`, `sign-in.html`. |
| Truck type list | `become-a-transporter.html`. |

Truber Design owns the final copy. Design-owned copy is marked `<!-- COPY: design/website/COPY.md -->`.

## Deploy

The Vercel project is `truber-web` (under team `craigmudirira`’s projects), Git-linked to `craigtanatswa/truber`. Set the root directory to `website`, the framework preset to Other, and provide no build command, install command or environment variables. The production branch is `main`.

`vercel.json` sets `cleanUrls` and security headers, including a strict CSP with no external origins. `README.md` is excluded from deploys via `.vercelignore`.

## Checks

Run Lighthouse mobile on every page and require all four categories to score at least 90. Also run:

- `html-validate` with `html-validate:recommended`.
- axe-core via Playwright.
- The contrast script over `tokens.css`.
- Playwright screenshots at 360, 768 and 1280 px, in light and dark themes.
- Network logs to confirm no third-party requests and zero requests on form submit.
- A JS-off check.

Evidence is kept outside the repo at `/home/box/truber/reports/evidence/brian-website/`.
