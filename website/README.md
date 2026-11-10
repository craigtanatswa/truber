# Truber website v2

## What this is

The static public marketing site for Truber, a Zimbabwe-first freight marketplace for shippers and transporters. It is plain HTML, CSS and vanilla JavaScript: no framework, build step, server code, environment values, API calls or third-party requests. The web app itself is a separate Flutter preview at `/app`.

## Run locally

```sh
npx serve website
```

`/app` is only available on Vercel: `vercel.json` rewrites it to the Mobile-owned preview. It does not resolve under `serve`.

## File structure

| File | Purpose |
| --- | --- |
| `index.html` | Home page. |
| `how-it-works.html` | Shipper and transporter flows. |
| `services.html` | Planned services. |
| `become-a-transporter.html` | Transporter application page with a demo form. |
| `about.html` | About Truber. |
| `safety.html` | Safety and trust. |
| `contact.html` | Contact page with a demo form. |
| `404.html` | Not-found page. |
| `styles.css` | Layout and component styles; design tokens only, no hex values. |
| `tokens.css` | Colour and type tokens; verbatim Design file. |
| `tokens-web-v2.css` | Design v2 tokens; verbatim; loaded after `tokens.css`. |
| `theme.js` | System/Light/Dark theme toggle. |
| `motion.js` | IntersectionObserver reveals and pinned-scene switch. |
| `forms.js` | Enables the contact and become-a-transporter demo forms, then blocks submission. |
| `vercel.json` | Clean URLs, `/app` rewrite, redirects and security headers. |
| `robots.txt` | Crawler rules; disallows `/app` and points to the sitemap. |
| `sitemap.xml` | Indexable public pages. |
| `site.webmanifest` | Web-app name, colours and icons. |
| `favicon.ico`, `apple-touch-icon.png`, `assets/icon-*.png`, `og-image.png` | Icons and social image derived from the user-supplied `icon-black-tile.png`; `og-image.png` is 1200 × 630. |
| `assets/logo/` | User originals, byte-identical: `wordmark-white-transparent.png` and `icon-transparent.png`. |
| `assets/fonts/` | Inter 4.1 variable, latin subset woff2; `OFL.txt` licence. |
| `assets/images/` | Generated image sets and provenance; see `MANIFEST.md`. |

## Design system

- Twelve-column grid within a 1200 px container.
- 64 px sticky black header: centred pill nav, theme toggle and an “Open web app” pill. Desktop nav shows from 1100 px; below that a `<details>` Menu keeps the header to one row from 640 px.
- One light band only: pricing. Every other section stays on the dark scaffold.
- No grain. Hairline dividers between sections.
- Header and footer stay black in both themes because the wordmark is white.

## Motion

- CSS plus `motion.js` IntersectionObserver. No scroll listeners and no scroll hijacking; native scroll only.
- Only `transform` and `opacity` animate, plus SVG stroke-draw on the feature icons.
- The hero media grows from a rounded tile to full-bleed once, over 900 ms. Text is never delayed or covered.
- The pinned crossfade scene is enhanced only at 960 px and above; image scale is capped at 1.05.
- Reveals, hairlines and icons draw once when they enter view.
- Without JS, all content is visible and the scene is a static stack; only the one-off CSS hero grow remains. `prefers-reduced-motion: reduce` disables all motion. Explicit image dimensions and `font-display: swap` keep CLS at 0.

## Hero readability

The Design scrim (`--v2-hero-scrim`) is combined with a left text-side layer (`--v2-hero-scrim-side`) under the hero copy so white text reaches 4.5:1. Below 640 px the hero bottom becomes a darker glass panel. Measured contrast is recorded in the evidence outside the repo.

## Images

All images are AI-generated with Grok Imagine, not photographs, and were upscaled ×2 with Real-ESRGAN. Each is served through `<picture>` with AVIF and WebP srcsets from 640 to 2560 px and a JPG fallback at 1280 and 1920 px. Every image has explicit `width`/`height`; the hero is eager and high priority, the rest lazy. See `assets/images/MANIFEST.md` for provenance, alt text and hashes.

## /app web app

- `vercel.json` rewrites `/app` and `/app/:path*` to `https://truber-mobile-preview.vercel.app/app/...`. The app is owned by Mobile.
- The site CSP and security headers apply to every path except `/app`, using the source pattern `/((?!app(?:/|$)).*)`, so the Flutter app’s own policy applies there.
- `/sign-in`, `/sign-in.html`, `/register` and `/register.html` are permanent (308) redirects to `/app` (`trailingSlash: false` also 308s `/app/` to `/app`; `cleanUrls` first 308s `*.html` to the clean path).
- `robots.txt` disallows `/app`.
- The home quick-quote form is a native GET to `/app?from=&to=` and shows no price. The CSP uses `form-action 'self'` for it.
- The contact and become-a-transporter forms are demos: `action="#"`, no network code, and `forms.js` prevents submission. Their meta CSP keeps `form-action 'none'`.

## Copy rules

- Do not claim live bookings, live payments, GPS tracking or automated matching.
- Cash is “Not protected”.
- “Protected payment” is never “escrow”. It is planned and in testing; Truber does not hold funds.
- Commission is 5% on completed trips; payment processing fees are separate.
- No booking is confirmed without a confirmed payment arrangement.

## Placeholders

There are **65** `PLACEHOLDER` comments in the HTML. Count them with:

```sh
grep -o PLACEHOLDER -r website --include=*.html | wc -l
```

| Kind | Count |
| --- | ---: |
| Engineering-drafted copy from `CONCEPT.md` | 43 |
| Scene statement and captions | 1 |
| Support contact | 10 |
| Social accounts | 8 |
| Demo form | 2 |
| Truck type list | 1 |
| **Total** | **65** |

Truber Design owns the final copy.

## Theme

With no stored choice, the site follows `prefers-color-scheme`. The toggle cycles System, Light and Dark and stores the choice under the `truber-theme` localStorage key.

The inline head script prevents a theme flash and is allowed by its SHA-256 hash in the `vercel.json` CSP: `sha256-haQ8sxFQgLVxzeyUjSEeIk0t5h6vpPco7B0chcsUgSw=`. Keep the script byte-identical on every page. If it changes, recompute the hash with:

```sh
python3 -c 'import re,hashlib,base64;s=re.search(r"<script>([^<]*)</script>",open("website/index.html").read()).group(1);print("sha256-"+base64.b64encode(hashlib.sha256(s.encode()).digest()).decode())'
```

## Search indexing

The site is indexable. There is no robots `noindex` meta and no `X-Robots-Tag`. Canonical and social URLs use https://truber-web.vercel.app. `robots.txt` allows crawling, disallows `/app` and points to `sitemap.xml`, which lists the seven indexable pages; `404.html` is excluded.

## Checks

- Lighthouse on mobile and desktop.
- axe-core via Playwright.
- `html-validate` with `html-validate:recommended`.
- Contrast checks over the tokens and hero text.
- Network logs: no third-party requests and no requests on demo form submit.
- Reduced-motion pass and a scroll trace.

Evidence is kept outside the repo.
