# Truber client (Flutter)

Connecting Cargo. Moving Business.

## Run

```bash
export PATH="/home/box/flutter/bin:$PATH"
cd /home/box/truber/app
flutter pub get
flutter run -d chrome

# Demo/dev builds (login hint + prefills; never ship with this in production):
flutter run -d chrome --dart-define=TRUBER_DEMO=true
flutter build web --dart-define=TRUBER_DEMO=true
```

Demo accounts (mock): `shipper@truber.zw`, `transporter@truber.zw`, `admin@truber.zw` — password `demopass`.

Web screenshot deep links: `#/demo/login`, `#/demo/shipper`, `#/demo/shipper/post`, `#/demo/shipper/quotes`, `#/demo/shipper/payment`, `#/demo/shipper/booking`, `#/demo/transporter/search`, `#/demo/admin`.

## Proof

```bash
flutter analyze
flutter test
flutter build web
```

Mocks implement repository interfaces from OpenAPI `../api/openapi.yaml` v0.1.0. Theme from `../design` (`truber_design` path package).

## Web build and report-only CSP

`deploy/build_web.sh` builds with CanvasKit self-hosted (`--no-web-resources-cdn`) and runs `deploy/write_csp.mjs`. That script hashes the inline splash script in the built `index.html` and writes `deploy/vercel.json`. The script also copies that file to `build/web/vercel.json` so a deploy of the build directory sends the header.

The header is `Content-Security-Policy-Report-Only`. It has no `report-uri` and no `report-to`. Violations show in the browser console only. Do not add a report endpoint, and do not switch the header to enforcing, until that choice is revisited.

`script-src` has no `'unsafe-inline'`. `style-src` still allows `'unsafe-inline'` because the Flutter engine injects a text-editing stylesheet. `frame-ancestors` is `'none'` and `form-action` is `'self'`.

Font fallbacks point at `fonts/` from `web/flutter_bootstrap.js` (a Flutter template; the tool fills in the service-worker version at build time). Roboto regular is vendored at `web/fonts/roboto/v20/`. Noto fallback faces are not vendored.

CanvasKit wasm, measured with Flutter 3.24.5: `chromium/canvaskit.wasm` 5.12 MB, `canvaskit.wasm` 6.44 MB, `skwasm.wasm` 3.07 MB. The whole `build/web` tree is 23.8 MB. Vercel Hobby allows 100 MB for the deployment.

For a live build, regenerate the policy with the API origin so `connect-src` allows it:

```bash
API_ORIGIN=https://api.example.com ./deploy/build_web.sh \
  --dart-define=TRUBER_DATA=live \
  --dart-define=API_BASE_URL=https://api.example.com
```

`API_ORIGIN` must be an exact `http` or `https` origin (no path). The same flag is `node deploy/write_csp.mjs --index build/web/index.html --api-origin https://api.example.com` if the web bundle is already built.
