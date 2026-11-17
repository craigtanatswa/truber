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

## Live session

In live mode the access token stays in memory. Only the refresh token is stored. On web that store is `localStorage` (`truber.refresh.token`).

If the browser blocks `localStorage` (private mode, or a policy that throws on storage access), the refresh token is never written. The in-memory sign-in ends at the first refresh: that refresh sees an empty store and treats it as logged out. The user has to sign in again.

## Proof

```bash
flutter analyze
flutter test
flutter build web
```

Mocks implement repository interfaces from OpenAPI `../api/openapi.yaml` v0.1.0. Theme from `../design` (`truber_design` path package).
