# Truber website v2

## What this is

The static public marketing site for Truber, a Zimbabwe-first freight marketplace for shippers and transporters. It is plain HTML, CSS and vanilla JavaScript: no framework, server code, API calls or third-party requests. `scripts/inject-config.mjs` runs at build time to copy the site into `dist/` and fill in deployment-specific values. The web app itself is a separate Flutter app at `/app`.

## Build and run locally

From this directory (`website/`):

```sh
node scripts/inject-config.mjs
npx serve dist
```

`/app` is only available on Vercel: `vercel.json` rewrites it to the Mobile-owned app. It does not resolve under `serve`.

## Environment values

The build reads two optional environment variables. Do not commit values.

| Variable | Purpose |
| --- | --- |
| `SUPPORT_EMAIL` | Optional single email address. When set, “Email support” `mailto:` links are injected at build time. When empty, those links and any element that exists only to hold them (the contact Support card and the safety support paragraph) are omitted. A change requires a redeploy. |
| `SITE_ORIGIN` | Optional absolute origin with no trailing slash (for example `https://www.example.com`). Used for canonical, Open Graph, Twitter, `robots.txt` and `sitemap.xml`. When unset on Vercel, defaults to `https://${VERCEL_URL}` so previews do not advertise production. Production should set `SITE_ORIGIN` once the custom domain exists. Locally, if both `SITE_ORIGIN` and `VERCEL_URL` are unset, the script uses `http://localhost:3000`. |

Nothing hard-codes the domain or mailbox in git. Source HTML uses `__SITE_ORIGIN__` and inject comments; the build replaces them. Support is mailto only. There is no contact form.

## File structure

| File | Purpose |
| --- | --- |
| `index.html` | Home page. |
| `how-it-works.html` | Shipper and transporter flows. |
| `services.html` | Launch services. |
| `become-a-transporter.html` | Transporter registration page. |
| `about.html` | About Truber. |
| `safety.html` | Safety and trust. |
| `contact.html` | Contact and support. |
| `terms.html` | Hidden, unlinked Terms of use shell. |
| `privacy.html` | Hidden, unlinked Privacy policy shell. |
| `404.html` | Not-found page. |
| `scripts/inject-config.mjs` | Build step: copies the site to `dist/` and injects the origin and support email values. |
| `styles.css` | Layout and component styles; design tokens only, no hex values. |
| `tokens.css` | Colour and type tokens; verbatim Design file. |
| `tokens-web-v2.css` | Design v2 tokens; verbatim; loaded after `tokens.css`. |
| `motion.js` | IntersectionObserver reveals and pinned-scene switch. |
| `hero-video.js` | Loads the home hero video only when the connection and motion preferences allow. |
| `vercel.json` | Build command, output directory, clean URLs, `/app` rewrite, redirects and security headers. |
| `robots.txt` | Crawler rules; disallows `/app` and points to the sitemap. |
| `sitemap.xml` | Indexable public pages. |
| `site.webmanifest` | Web-app name, colours and icons. |
| `favicon.ico`, `apple-touch-icon.png`, `assets/icon-*.png`, `og-image.png` | Icons and social image derived from the user-supplied `icon-black-tile.png`; `og-image.png` is 1200 × 630. |
| `assets/logo/` | User originals, byte-identical: `wordmark-white-transparent.png` and `icon-transparent.png`. |
| `assets/fonts/` | Inter 4.1 variable, latin subset woff2; `OFL.txt` licence. |
| `assets/images/` | Generated image sets and provenance; see `MANIFEST.md`. |

## Design system

- Twelve-column grid within a 1200 px container.
- 64 px sticky black header: centred pill nav and an “Open web app” pill. Desktop nav shows from 1100 px; below that a `<details>` Menu keeps the header to one row from 640 px.
- One light band only: pricing. Every other section stays on the dark scaffold.
- No grain. Hairline dividers between sections.
- Header and footer stay black because the wordmark is white.

## Motion

- CSS plus `motion.js` IntersectionObserver. No scroll listeners and no scroll hijacking; native scroll only.
- Only `transform` and `opacity` animate, plus SVG stroke-draw on the feature icons.
- The hero media grows from a rounded tile to full-bleed once, over 900 ms. Text is never delayed or covered.
- The pinned crossfade scene is enhanced only at 960 px and above; image scale is capped at 1.05.
- Reveals, hairlines and icons draw once when they enter view.
- Without JS, all content is visible and the scene is a static stack; only the one-off CSS hero grow remains. `prefers-reduced-motion: reduce` disables all motion. Explicit image dimensions and `font-display: swap` keep CLS at 0.
- The home hero uses `hero-video.js` to swap in the looping video only when the connection and motion preferences allow; the poster remains the fallback.

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

## Copy rules

- Describe only what works on launch day.
- Cash, bank transfer or mobile money are Not protected. Truber doesn’t hold any funds, and the shipper pays the transporter directly.
- Tracking means trip status updates. Do not use GPS, ETA or live-tracking wording.
- Do not mention protected payment, escrow, preview, beta, demo, test/testing, coming soon, planned, TBC or upload in user-visible copy. Use “add” instead of “upload”.
- Do not name Paynow, EcoCash, OneMoney, Telecash, InnBucks or BuySafe.
- Commission is 5% on completed trips, charged to the transporter. There is no fee to sign up or to quote.

## Hidden legal shells

`terms.html` and `privacy.html` are `noindex, nofollow`, unlinked shells with the shared header and footer. They are not in `sitemap.xml`, `robots.txt` or any navigation. They stay unpublished until legal text arrives.

## Theme

The website is dark only. There is no theme toggle and no inline script; styles.css pins the dark palette from tokens.css, and the CSP allows scripts from 'self' only. The light/dark toggle lives in the web app (/app).

## Search indexing

The seven public pages are indexable and listed in `sitemap.xml`; `404.html`, `terms.html` and `privacy.html` are excluded. Canonical and social URLs are built from `SITE_ORIGIN`. `robots.txt` allows crawling, disallows `/app` and points to `sitemap.xml`.

## Checks

- Lighthouse on mobile and desktop.
- axe-core via Playwright.
- `html-validate` with `html-validate:recommended`.
- Contrast checks over the tokens and hero text.
- Network logs: no third-party requests.
- Reduced-motion pass and a scroll trace.

Evidence is kept outside the repo.
